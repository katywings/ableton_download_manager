#!/usr/bin/env node

var _ = require( 'lodash' );
var os = require('os')
var path = require('path');
var pathExists = require('path-exists');
var fs = require( 'fs' );
var moment = require('moment');
var cli = require( 'cli' ).enable( 'help', 'status', 'version', 'glob' );
var prompt = require('prompt');
var config = require('config');
const Browser = require('zombie');
Browser.silent = true;
const browser = new Browser({
    waitDuration: 29*1000
});
var request = require('request');

var ableton = {
	login: {
		url: "https://www.ableton.com/login"
		, username: '#id_username'
		, password: '#id_password'
		, submit: '.test-login-form .form__submit input[type="submit"]'
	}
	, downloadFileNameRegex: /(.*?)_(.*?v.*?)\.alp/
	, account: {
		url: "/account/"
		, downloadItems: ".downloads .downloads__item"
		, downloadItemName: ".downloads__item__description__title"
		, downloadItemButton: "a.js-download-button"
	}
	, packs: {
		url: "https://www.ableton.com/packs/"
		, downloadItems: ".packs-wrapper .test-pack"
		, downloadItemName: ".pack-teaser__title a.test-pack-detail"
		, downloadItemButton: "a.js-download-button"
	}
};

cli.parse( {
	init: [ 'i', 'Initial launch and setup a new packs file' ]
	, username: [ 'u', 'The username of your Ableton account', 'string', '' ]
	, password: [ 'p', 'The password of your Ableton account', 'string', '' ]
} );

var packsFilePath = 'packs.json';
var packsBackupFilePath = 'backups/' + moment().format( config.get( 'backupFileTimestamp' ) ) + '_packs.json';

var downloadPacks = function( packs, callback ) {
	var pack = _.first( packs );
	if ( pack != undefined ) {
		var filePath = config.get( 'downloadPath' ) + path.basename( pack.url );
		if ( pathExists.sync( filePath ) ) {
			cli.info( 'Removed old file "' + filePath + '"' );
			fs.unlinkSync( filePath );
		}
		cli.info( 'Start downloading ' + pack.name + ' (' + pack.version + ')' );
		var stream = new request( {
			url: pack.url
			, timeout: config.get( 'downloadTimeout' )
		} );
		var writeStream = fs.createWriteStream( filePath );
		stream.on( 'end', function() {
			cli.ok( pack.name + ' (' + pack.version + ') downloaded' );
			localPackIndex = _.findIndex( localPacks, { id: pack.id } );
			pack.oldVersion = null;
			delete pack.oldVersion;
			if ( localPackIndex == -1 ) {
				localPacks.push( pack );
			} else {
				localPacks[ localPackIndex ] = pack;
			}
			savePacksFile( localPacks );
			downloadPacks( _.tail( packs ), callback );
		} );
		stream.on( 'error', function( err ) {
			callback.call( this, err );
		} );
		stream.pipe( writeStream );
	} else {
		callback.call();
	}
};

var packsFileExists = function() {
	return pathExists.sync( packsFilePath );
};

var readPacksFile = function() {
	var localPacks = [];
	if( packsFileExists() ) {
		var packsFileContent = fs.readFileSync( packsFilePath, 'utf-8' );
		if ( packsFileContent.trim() != '' ) {
			localPacks = JSON.parse( packsFileContent );
		}
	}
	return localPacks;
};

var savePacksFile = function( packs ) {
	_.forEach( packs, function( elem ) {
		elem.idLower = elem.id.toLowerCase();
	} );
	packs = _.sortBy( packs, [ 'idLower' ] );
	_.forEach( packs, function( elem ) {
		elem.idLower = null;
		delete elem.idLower;
	} );
	fs.writeFileSync( packsFilePath, JSON.stringify( packs, null, 2 ) );
	fs.writeFileSync( packsBackupFilePath, JSON.stringify( packs, null, 2 ) );
};

var localPacks = readPacksFile();
var allPacks = [];

var analyseDownloads = function( downloads, context ) {
	_.forEach( downloads, function( elem ) {
		var elemUrl = elem.querySelector( context.downloadItemButton );
		if( elemUrl != null && elemUrl.getAttribute( 'href' ) != null && elemUrl.getAttribute( 'href' ) != '' ) {
			var url = elemUrl.getAttribute( 'data-cdn-link' );
			var fileNameRegex = ableton.downloadFileNameRegex.exec( path.basename( url ) );
			var version = '';
			var key = _.uniqueId();
			if ( fileNameRegex != null ) {
				key = fileNameRegex[ 1 ];
				version = fileNameRegex[ 2 ];
			}
			var pack = _.find( allPacks, { id: key } );
			if ( pack == undefined ) {
				allPacks.push( {
					id: key
					, name: browser.text( context.downloadItemName, elem )
					, url: url
					, version: version
				}) ;
			}
		}
	} );
};

cli.main( function( args, options ) {
	var self = this;

	var username = config.get( 'username' );
	var password = config.get( 'password' );

	if ( options.username.trim() != '' ) {
		username = options.username.trim();
	}
	if ( options.password.trim() != '' ) {
		password = options.password.trim();
	}

	self.info( 'Logging in with: "' + username + '"' );

    browser.visit( ableton.login.url, function() {
    	browser.fill( ableton.login.username, username );
    	browser.fill( ableton.login.password, password );
    	browser.pressButton( ableton.login.submit, function() {
	    	if ( browser.location.href.indexOf( ableton.account.url ) == -1 ) {
	    		self.error( 'Login was not correct' );
	    		process.exit( 1 );
	    	} else {
	    		self.ok( 'Login successful' );

	    		self.info( 'Downloading current packs info' );

	    		var downloads = browser.querySelectorAll( ableton.account.downloadItems );
	    		analyseDownloads( downloads, ableton.account );

	    		browser.visit( ableton.packs.url, function() {
	    			var downloads = browser.querySelectorAll( ableton.packs.downloadItems );
	    			analyseDownloads( downloads, ableton.packs );

	    			if ( options.init === true ) {
		    			var msg = 'Packs file gonna be initialised, press <enter> to start';
		    			if ( packsFileExists() ) {
		    				msg = 'Packs file does already exist, press <enter> to overwrite';
		    			}
		    			self.info( msg );
		    			prompt.start();
		    			prompt.get( [ 'enter' ], function( err, result ) {
		    				if( result == undefined ) process.exit( 0 );
		    				savePacksFile( allPacks );
		    				self.info( 'NOW open packs.json and DELETE all PACKS WHICH you want TO DOWNLOAD' );
		    				prompt.get( [ 'enter' ], function( err, result ) {
		    					if( result == undefined ) process.exit( 0 );
		    					localPacks = readPacksFile();
		    					afterInit();
		    				} );
		    			} );
		    		} else {
		    			afterInit();
		    		}
	    		} );
	    	}
		} );
	} );
} );

var afterInit = function() {
	cli.info( 'Comparing local with online available packs' );

	var oldPacks = [];
	_.forEach( allPacks, function( pack ) {
		var localPack = _.find( localPacks, { id: pack.id } );
		if ( localPack == undefined || localPack.version != pack.version ) {
			if ( localPack != undefined ) pack.oldVersion = localPack.version;
			oldPacks.push( pack );
		}
	} );

	if ( !_.isEmpty( oldPacks ) ) {
		oldPacks = _.sortBy( oldPacks, [ 'name', 'version' ] );
		cli.info( 'Updates available for the following packs:' );
		_.forEach( oldPacks, function( pack ) {
			var oldVersionString = '';
			if ( pack.oldVersion != null ) {
				oldVersionString = ' (old: ' + pack.oldVersion + ')';
			}
			console.log( pack.name + ' (new: ' + pack.version + ')' + oldVersionString );
		} );

		cli.info( 'Press <enter> to start the downloads!' );
		prompt.get( [ 'enter' ], function( err, result ) {
			if( result == undefined ) process.exit( 0 );
			setInterval( function() {
				browser.visit( ableton.account.url );
				cli.info( 'Session updated' );
			}, config.get( 'sessionUpdateInterval' ) * 1000 );
			downloadPacks( oldPacks, function( err ) {
				if ( err ) {
					cli.error( err );
					process.exit( 1 );
				} else {
					cli.ok( 'All downloads completed' );
					process.exit( 0 );
				}
			} );
		} );
	} else {
		cli.ok( 'Everything up to date');
		process.exit( 0 );
	}
}
