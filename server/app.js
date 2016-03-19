var express = require('express');
var _ = require('underscore');
var Q = require('q');
var historyDao = require('./lib/historyDao');
var Tracker = require('./lib/tracker');
var Project = require('./lib/Project');
var Config = require('../package.json');
var Path = require('path');

// command line parameters

var opts = require('nomnom')
   .option('port', {
      help: 'Port server should listen to',
	  default: Config.omega.port
   })
   .option('password', {
      help: 'password for admin',
      default: Config.omega.password
   })
   .option('dbpath', {
      help: 'path where all omega information should be stored. Directory must exist and have appropriate rights',
      default: Path.resolve(Path.dirname(Config.filename), Config.omega.dbpath)
   })
   .option('redis', {
      help: 'Flag, inidicates whether Redis should be used for storing info or not',
	  flag: true,
      default: Config.omega.redis
   })
   .option('optimized', {
	   default: false
   })
   .parse();

var version = Config.version;
var lActualPort = process.env.OMEGA_PORT || opts.port;
var lAdminPassword = process.env.OMEGA_ADM_PASS || opts.password;

//dirs 
var lStaticDocsDir = Path.resolve(__dirname, '../public');
var lViewsDir = Path.resolve(__dirname, '../views');
var lDBsDir = process.env.OMEGA_DB_PATH || opts.dbpath;

var projectDao, issueDao;

if (opts.redis) {
	var client = process.env.REDISTOGO_URL ? require('redis-url').connect(process.env.REDISTOGO_URL) : require('redis').createClient();
	var RedisProjectDao = require('./lib/RedisProjectDao');
	projectDao = new RedisProjectDao(client);
	var RedisIssueDao = require('./lib/RedisIssueDao');
	issueDao = new RedisIssueDao(client);
} else {
	var db_dir;
	if (process.env['NODE_ENV'] === 'nodester') {
		db_dir = __dirname + '/../'; // override due to https://github.com/nodester/nodester/issues/313
	}
	else {
	    db_dir = lDBsDir;
	}

	projectDao = require('./lib/projectDao');
	projectDao.init(db_dir);
	issueDao = require('./lib/issueDao');
	issueDao.init(db_dir);
}

var app = express.createServer();

app.configure('development', function () {
	console.log('Starting development server');

	var lessMiddleware = require('less-middleware');
	app.use(lessMiddleware({
		debug: true,
		src: Path.resolve(__dirname, 'server'),
		dest: Path.resolve(__dirname, 'public')
	}));
});

app.configure(function () {
	app.set('views', lViewsDir);
	app.register('.html', require('ejs')); // call our views html

	app.use(express.logger());
	app.use(express.cookieParser());
	app.use(express.session({ secret: 'nyan cat' })); // for flash messages
	app.use(express.static(lStaticDocsDir));

	app.use(express.bodyParser());
	app.use(express.methodOverride());
	app.use(app.router);
});

app.listen(lActualPort);

// TODO: extract routes elsewhere

app.get('/', function (req, res) {
	projectDao.findAll(function (err, projects) {
		var listed = [],
			unlisted = 0;
		_.each(projects, function (project) {
			if (!project.deleted) {
				if (project.unlisted) {
					unlisted++;
				} else {
					listed.push(project);
				}
			}
		});
		_.sortBy(listed, function (p) { return p.name; });
		res.render('index.html', viewOptions({
			projects: listed,
			unlisted: unlisted
		}));
	});
});
app.post('/project', function (req, res) {
	var name = req.body.projectName;
	if (!name) {
		res.json({ error: 'empty' }, 400);
		return;
	} else if (!projectDao.isValidName(name)) {
		res.json({ error: 'invalid' }, 400);
		return;
	}

	projectDao.create(name, !!req.body.unlisted, function (err, project) {
		if (err) {
			if (err.message === 'project exists') {
				var url = '/project/' + Project.slugify(name);
				res.json({ error: 'exists', url: url }, 409);
				return;
			}
			throw err;
		}
		Tracker.listen(project);
		var message = project.unlisted ? "Here's your project. Remember: it's unlisted, so nobody'll find it unless you share the address." : "Here's your project.";
		req.flash('info', message);
		res.json({ url: project.url });
	});
});
app.get('/project', function (req, res) {
	res.statusCode = 404;
	res.end('Nothing to see here. Try /project/<name>');
});
app.get('/project/:slug', function (req, res) {
	projectDao.find(req.params.slug, function (err, project) {
		if (project && !project.deleted) {
			var flash = req.flash('info');
			var message = flash.length ? _.first(flash) : null;

			res.render('project.html', viewOptions({
				title: project.name,
				flash: message,
				noindex: project.unlisted
			}));
		} else if (project && project.deleted) {
			res.statusCode = 410; // Gone
			res.end('Project deleted');
		} else {
			res.statusCode = 404;
			res.end('No such project');
		}
	});
});
app.get('/project/:slug/export', function (req, res) {
	projectDao.find(req.params.slug, function (err, project) {
		var filename = project.name + '.json';
		res.setHeader('Content-disposition', 'attachment; filename=' + filename);
		issueDao.load(project, function (err, issues) {
			res.json(issues);
		});
	});
});


var auth = express.basicAuth('admin', lAdminPassword);

app.get('/admin', auth, function (req, res) {
	projectDao.findAll(function (err, projects) {
		Q.all(projects.map(function (project) {
			return Q.ninvoke(issueDao, 'count', project).then(function (count) {
				project.issueCount = count;
				return project;
			});
		})).then(function (projects) {
			res.render('admin.html', viewOptions({
				projects: projects,
				flash: req.flash(),
				noindex: true
			}));
		});
	});
});

app.put('/project/:slug', auth, function (req, res) {
	projectDao.find(req.params.slug, function (err, original) {
		var updated = {};
		_.each(['unlisted', 'deleted'], function (prop) {
			var set = req.body[prop] === 'on';
			updated[prop] = set;
		});
		projectDao.update(req.params.slug, updated, function (err) {
			var success = !err;
			buildAdminFlashMessage(req, original, 'update', success);
			res.redirect('back');
		});
	});
});

app.delete('/project/:slug/issues', auth, function (req, res) {
	projectDao.find(req.params.slug, function (err, project) {
		issueDao.reset(project, function (err) {
			historyDao.reset(project);
			req.flash('info', 'All issues in project \'' + project.name + '\' have been deleted.');
			res.redirect('back');
		});
	});
});

function buildAdminFlashMessage(req, project, action, success) {
	var type = success ? 'info' : 'error';
	var message = success ? 'Project \'' + project.name + '\' has been ' + action + 'd.' : 'Oops, could not ' + action + ' \'' + project.name + '\'';
	req.flash(type, message);
}

function viewOptions(options) {
	return _.extend({}, { version: version }, options);
}

Tracker.init(app, projectDao, issueDao);

console.log('Ω v' + version + ' running on port ' + lActualPort);
