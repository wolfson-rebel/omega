define(['jquery', 'ko', 'underscore', 'util'], function ($, ko, _, util) {

	var USERNAME_KEY = 'OmegaIssueTracker.username';

	var NAMES = [
		'Captain Hammer', 'Release Llama', 'Chuck Norris',
		'Snozzcumber', 'Hurley', 'Inigo Montoya', 'Leeroy Jenkins',
		'Richard Castle'
	];

	function UserManager($nameInput, socket) {
		this.$nameInput = $nameInput;
		this.namePlaceholder = util.getRandomItem(NAMES);
		this.invalidName = ko.observable(false);

		this.user = ko.observable(window.localStorage[USERNAME_KEY]);
		this.onlineUsers = ko.observableArray();

		this.loggedIn = ko.observable(false);
		this.logout = _.bind(this.logout, this);

		this.socket = socket;
		this.socket.on('usernames', _.bind(populateOnlineUsers, this));
	}

	function populateOnlineUsers(users) {
		this.onlineUsers(_.map(users, function (count, name) {
			return { name: name, count: count };
		}));
	}

	UserManager.prototype.noUser = function () {
		return !this.user();
	};

	UserManager.prototype.attemptLogin = function () {
		this.invalidName(false);
		var name = this.$nameInput.val();
		if (!name || name.trim().length < 3) { // TODO: disallow other chars?
			this.invalidName(true);
			return;
		}

		this.login(name);
	};

	UserManager.prototype.login = function (name) {
		var that = this;
		this.loggedIn(false);
		this.socket.emit('login user', name, function (invalidName) {
			if (!invalidName) {
				window.localStorage[USERNAME_KEY] = name;
				that.$nameInput.val('');
				that.user(name);
			}
			that.loggedIn(!invalidName);
			that.invalidName(invalidName);
		});
	};

	UserManager.prototype.logout = function () {
		this.$nameInput.focus();
		delete window.localStorage[USERNAME_KEY];
		this.user(undefined);
		this.socket.emit('logout');
	};

	UserManager.prototype.loginExistingUserIfAny = function () {
		if (this.user()) {
			this.login(this.user());
		}
	};

	UserManager.prototype.isCurrentUser = function (name) {
		return this.user() && name.toLowerCase() === this.user().toLowerCase();
	};

	return UserManager;

});