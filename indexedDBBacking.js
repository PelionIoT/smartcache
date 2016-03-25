var Promise = require('es6-promise').Promise;

var makeIndexedDBBacking = function(cache,dbname,opts) {

	var log_err = function() {
	    if(global.log)
	        log.error.apply(log,arguments);
	    else {
	        var args = Array.prototype.slice.call(arguments);
	        args.unshift("ERROR");
	        args.unshift("[IndexDBBacking]");
	        console.error.apply(console,args);
	    }

	};

	var log_warn = function() {
	    if(global.log)
	        log.warn.apply(log,arguments);
	    else {
	        var args = Array.prototype.slice.call(arguments);
	        args.unshift("WARN");
	        args.unshift("[IndexDBBacking]");
	        console.error.apply(console,args);
	    }
	};

	var ON_log_dbg = function() {
	    var args = Array.prototype.slice.call(arguments);
	    args.unshift(" {"+(new Date).getTime()+"}");
	    args.unshift("[IndexDBBacking]");
	    if(global.log)
	        log.debug.apply(log,args);
	    else
	        console.log.apply(console,args);
	};

	var log_dbg = function() {}


	var rdThrottle = undefined;	
	var wrThrottle = undefined;
	var dlThrottle = undefined;

	if(opts) {
		if(opts.debug_mode) log_dbg = ON_log_dbg;
		if(opts.dbThrottle) {
			rdThrottle = opts.dbThrottle;
			wrThrottle = opts.dbThrottle;
			dlThrottle = opts.dbThrottle;
		}
	}

	var BACKING_VERSION = 1; // if we make changes to the database - then increment this
							 // and fix onupgradeneeded below.
	var KEYSTORE = "data";

	// In the following line, you should include the prefixes of implementations you want to test.
	var indexedDB = window.indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;

	// Moreover, you may need references to some window.IDB* objects:
	var IDBTransaction = window.IDBTransaction = window.IDBTransaction || window.webkitIDBTransaction || window.msIDBTransaction || {READ_WRITE: "readwrite"}; // This line should only be needed if it is needed to support the object's constants for older browsers
	var IDBKeyRange = window.IDBKeyRange = window.IDBKeyRange || window.webkitIDBKeyRange || window.msIDBKeyRange;
	// (Mozilla has never prefixed these objects, so we don't need window.mozIDB*)

	var DB = null; // object is made via onConnectCB below

	var genericErrorHandler = function(event) {
	  	log_err("Database error: " + event.target.errorCode);
	};

	// // This event is only implemented in recent browsers
	// request.onupgradeneeded = function(event) { 
	//   var db = event.target.result;

	//   // Create an objectStore for this database
	//   var objectStore = db.createObjectStore("name", { keyPath: "myKey" });
	// };

	var	makeTuple = function(key,val) {
	 	return { key: key, val: val };
	}

	// writeCB,readCB,onConnectCB,onDisconnectCB,opts
	return new cache.Backing({
		writeCB: function(pairs){  // writeCB
			return new Promise(function(resolve,reject){
	//			var trans = DB.transaction([KEYSTORE],IDBTransaction.READ_WRITE);  // make transaction
				var trans = DB.transaction([KEYSTORE],"readwrite");  // make transaction

				trans.oncomplete = function(evt) {
					log_dbg("transaction complete.");
					resolve();
				}

				trans.onerror = function(evt) {
					log_err("Error in writeCB:",evt);
					reject(evt);
				}
	//			var trans = DB.transaction([KEYSTORE],"readwrite");  // new way  - make transaction
				var keyz = Object.keys(pairs);
				var store = trans.objectStore(KEYSTORE);
				for(var n=0;n<keyz.length;n++) {
					var pair = makeTuple(keyz[n],pairs[keyz[n]]);
					log_dbg("put:",pair);
					var req = store.put(pair);
					(function(pair){
						req.onerror = function(){
							log_err("Error adding",pair);
						}
					})(pair);
				}
				log_dbg("transaction: wrote",keyz.length,"to indexedDB");
			});
		},
		readCB: function(pairs,cache) {  // readCB
			return new Promise(function(resovle,reject){
				var totalReads = 0;

				var checkComplete = function() {
					if(totalReads >= pairs.length) {
						resovle(cache);
					}
					// FIXME - need to figure out how to return errors
				}

				var getKey = function(key) {
					var trans = DB.transaction([KEYSTORE]);  // make transaction
					var store = trans.objectStore(KEYSTORE);				
					var request = store.get(key);
					request.onerror = function(event) {
						log_err("Error in readCB (key:",key,") ->",event);
//						ret[key] = null;
						totalReads++;
						checkComplete();
					};
					request.onsuccess = function(event) {
					  // Do something with the request.result!
	//				  alert("Name for SSN 444-44-4444 is " + request.result.name);
						cache.set(key,request.result.val);
						totalReads++;
						checkComplete();
					};
				}

				for(var n=0;n<pairs.length;n++) {
					getKey(pairs[n])
				}
			});
		},
		deleteCB: function(keys){
			return new Promise(function(resovle,reject){
				var totalDels = 0;

				var trans = DB.transaction([KEYSTORE],"readwrite");  // make transaction
				var store = trans.objectStore(KEYSTORE);				

				var checkComplete = function() {
					if(totalDels >= keys.length) {
						resovle();
					}
					// FIXME - need to figure out how to return errors
				}

				var delKey = function(key) {
					var request = store.delete(key);
					request.onerror = function(event) {
						log_err("Error in delCB (key:",key,") ->",event);
						totalDels++;
						checkComplete();
					};
					request.onsuccess = function(event) {
						totalDels++;
						checkComplete();
					};
				}

				for(var n=0;n<keys.length;n++) {
					delKey(keys[n])
				}
			});			
		},

		onConnectCB: function() {      // onConnectCB
			return new Promise(function(resolve,reject) {
				indexedDB.onerror = genericErrorHandler;

				log_dbg("creating DB");
				var request = indexedDB.open(dbname,BACKING_VERSION);
				request.onerror = function(event) {
					reject();
					log_err("Can't get indexedDB db why??:",event);
				};
				request.onsuccess = function(event) {
			     	log_dbg("makeIndexDBBacking..onsuccess");
					DB = event.target.result;
					DB.onerror = genericErrorHandler;
					resolve();
				};

				// called when the database is first created or when the version requested is newer.
			    request.onupgradeneeded = function (evt) {
			     	log_dbg("makeIndexDBBacking..onupgradeneeded",evt);
					var db = evt.currentTarget.result;
			      	var store = db.createObjectStore(KEYSTORE, { keyPath: 'key'});
					store.createIndex('key', 'key', { unique: "true" });
					// Use transaction oncomplete to make sure the objectStore creation is 
					// finished before adding data into it.

					// NOTE - the onsuccess handler is triggered after the onupgradeneeded handler runs 
					// succesfully. See: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB#Creating_or_updating_the_version_of_the_database

					// store.transaction.oncomplete = function(event) {
					// 	resolve();
					// };
			      // 	var store = evt.currentTarget.result.createObjectStore(
				     //    DB_STORE_NAME, { keyPath: 'id', autoIncrement: true });
			      // store.createIndex('biblioid', 'biblioid', { unique: true });
			      // store.createIndex('title', 'title', { unique: false });
			      // store.createIndex('year', 'year', { unique: false });
			    };
			});
		}
	},{
		id: "indexedDBBack:"+dbname,
		rdThrottle: rdThrottle,
		dlThrottle: dlThrottle,
		wrThrottle: wrThrottle
	});

}

module.exports = makeIndexedDBBacking;