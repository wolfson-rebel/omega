var tracker; // for debugging only

require.config({
	paths: {
		'jquery': 'http://ajax.googleapis.com/ajax/libs/jquery/1.7.1/jquery.min',
		'ko': 'lib/knockout-2.0.0.min',
		'underscore': 'lib/underscore-1.2.2.min',
		'timeago': 'lib/jquery.timeago'
	}
});


require(['jquery', 'Tracker'], function ($, Tracker) {

	var socket = io.connect(); // would love to push this into module, but causes odd race condition in some browser

	$(function () {
		if (!isLocalStorageSupported) {
			alert("Your browser is very out of date. To use Ω, please use a newer browser."); // TODO: graceful degradation
			return;
		}

		tracker = new Tracker($("#nameInput"), $("#messageInput"), $("#form"), $("#messages"), socket);
	});
	
	function isLocalStorageSupported() {
		try {
			return 'localStorage' in window && window['localStorage'] !== null;
		} catch (e) {
			return false;
		}
	}

});

