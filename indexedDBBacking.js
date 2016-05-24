var Promise = require('es6-promise').Promise;
var makeIndexedDBBacking = function(cache, dbname, opts) {
    var log_err = function() {
        if (global.log) log.error.apply(log, arguments);
        else {
            var args = Array.prototype.slice.call(arguments);
            args.unshift("ERROR");
            args.unshift("[IndexDBBacking]");
            console.error.apply(console, args);
        }
    };
    var log_warn = function() {
        if (global.log) log.warn.apply(log, arguments);
        else {
            var args = Array.prototype.slice.call(arguments);
            args.unshift("WARN");
            args.unshift("[IndexDBBacking]");
            console.error.apply(console, args);
        }
    };
    var ON_log_dbg = function() {
        var args = Array.prototype.slice.call(arguments);
        args.unshift(" {" + (new Date).getTime() + "}");
        args.unshift("[IndexDBBacking]");
        if (global.log) log.debug.apply(log, args);
        else console.log.apply(console, args);
    };
    var log_dbg = function() {}
    var rdThrottle = undefined;
    var wrThrottle = undefined;
    var dlThrottle = undefined;
    var indexedDB = null;
    var shimFix = false;
    if (opts) {
        if (opts.debug_mode) log_dbg = ON_log_dbg;
        if (opts.dbThrottle) {
            rdThrottle = opts.dbThrottle;
            wrThrottle = opts.dbThrottle;
            dlThrottle = opts.dbThrottle;
            indexedDB = opts.indexedDB;

            // what is this?
            // a fix for this crap: 
            // https://github.com/axemclion/IndexedDBShim/issues/121
            shimFix = opts.shimFix; 
        }
    }
    var BACKING_VERSION = 1; // if we make changes to the database - then increment this
    // and fix onupgradeneeded below.
    var KEYSTORE = "data";
    // In the following line, you should include the prefixes of implementations you want to test.
    if(indexedDB === null || indexedDB === undefined)
        indexedDB = window.indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
    // Moreover, you may need references to some window.IDB* objects:
    var IDBTransaction = window.IDBTransaction = window.IDBTransaction || window.webkitIDBTransaction || window.msIDBTransaction || {
        READ_WRITE: "readwrite"
    }; // This line should only be needed if it is needed to support the object's constants for older browsers
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
    var makeTuple = function(key, val, timeval) {
            return {
                _key: key,
                _last: timeval,
                val: val
            };
        };
        // called after start to load initial data into cache.
    var loadDB = function(cache) {
        return new Promise(function(resolve, reject) {
            var transaction = DB.transaction([KEYSTORE],"readonly");
            var objectStore = transaction.objectStore(KEYSTORE);

            var res = objectStore.openCursor();
            res.onerror = function(e){
            	reject(e);
            };
            res.onsuccess = function(event) {
                var cursor = event.target.result;
                if (cursor) {
                	if (cursor.key && typeof cursor.value == 'object' && cursor.value.val) {
	                    // var listItem = document.createElement('li');
	                    // listItem.innerHTML = cursor.value.albumTitle + ', ' + cursor.value.year;
	                    // list.appendChild(listItem);
	                    log_dbg("cursor",cursor);
	                    var e = cache.get(cursor.key);
	                    if(e) {
	                    	// existing entry in cache, so let's put it in the IndexedDB
	                    	// do this???
	                    } else {
	                    	// no entry in cache, so let's use what's in 
	                    	// storage.
	                    	log_dbg("loading key",cursor.key);
	                    	cache.set(cursor.key,cursor.value.val);
	                    }                		
                	} else {
                		log_dbg("Empty or malformed data in IndexedDB:",cursor);
                	}
                    cursor.continue();
                } else {
                    log_dbg('loadDB complete.');
                    resolve();
                }
            };
        });
    };

    // writeCB,readCB,onConnectCB,onDisconnectCB,opts
    return new cache.Backing({
        writeCB: function(pairs) { // writeCB
            return new Promise(function(resolve, reject) {
                //			var trans = DB.transaction([KEYSTORE],IDBTransaction.READ_WRITE);  // make transaction
                var trans = DB.transaction([KEYSTORE], "readwrite"); // make transaction
                var keyz = Object.keys(pairs);
                var store = trans.objectStore(KEYSTORE);

                trans.oncomplete = function(evt) {
                    log_dbg("transaction complete.");
                    resolve();
                }
                trans.onerror = function(evt) {
                        log_err("Error in writeCB:", evt);
                        reject(evt);
                    }
                for (var n = 0; n < keyz.length; n++) {
                    var pair = makeTuple(keyz[n], pairs[keyz[n]].val, pairs[keyz[n]].last);

                    (function(_pair) {
                        var step2 = function() {
                            var req2 = store.put(_pair);

                            req2.onerror = function() {
                                log_err("Error adding", _pair);
                            }
                        }

                        log_dbg("put:", _pair);
                        var req1 = store.get(keyz[n]);

                        req1.onsuccess = function(ev) {
                            if(typeof req1.result === 'object') {
                                if(req1.result._last) {
                                    if(req1.result._last < _pair._last) {
                                        step2();
                                    } else {
                                        log_dbg("data was stale, not writing",_pair);
                                    }
                                } else {
                                    step2();
                                }
                            } else {
                                step2();
                            }   
                        }

                        req1.onerror = function(ev) {
                            log_err("Error in writeCB - reading",_pair);
                        }
                    })(pair);
                }
                log_dbg("transaction: wrote", keyz.length, "keys to indexedDB");
            });
        },
        readCB: function(pairs, cache) { // readCB
            return new Promise(function(resovle, reject) {
                var totalReads = 0;
                log_dbg("in readCB()")
                var checkComplete = function() {
                    if (totalReads >= pairs.length) {
                        resovle(cache);
                    }
                    // FIXME - need to figure out how to return errors
                }
                var getKey = function(key) {
                    var trans = DB.transaction([KEYSTORE]); // make transaction
                    var store = trans.objectStore(KEYSTORE);
                    var request = store.get(key);
                    request.onerror = function(event) {
                        log_err("Error in readCB (key:", key, ") ->", event);
                        //						ret[key] = null;
                        totalReads++;
                        checkComplete();
                    };
                    request.onsuccess = function(event) {
                        // Do something with the request.result!
                        //				  alert("Name for SSN 444-44-4444 is " + request.result.name);
                        if (typeof request.result === 'object') {
                            cache.set(key, request.result.val);
                        } else {
                            log_dbg("Missing request.result  - result no value", request);
                        }
                        totalReads++;
                        checkComplete();
                    };
                }
                log_dbg("pairs to read:", pairs.length);
                if (!pairs || pairs.length < 1) {
                    resolve();
                    return;
                }
                for (var n = 0; n < pairs.length; n++) {
                    log_dbg("in loop ", n);
                    getKey(pairs[n])
                }
                log_dbg("end readCB() Promise.")
            });
        },
        deleteCB: function(keys) {
            return new Promise(function(resovle, reject) {
                var totalDels = 0;
                var trans = DB.transaction([KEYSTORE], "readwrite"); // make transaction
                var store = trans.objectStore(KEYSTORE);
                var checkComplete = function() {
                    if (totalDels >= keys.length) {
                        resovle();
                    }
                    // FIXME - need to figure out how to return errors
                }
                var delKey = function(key) {
                    var request = store.delete(key);
                    request.onerror = function(event) {
                        log_err("Error in delCB (key:", key, ") ->", event);
                        totalDels++;
                        checkComplete();
                    };
                    request.onsuccess = function(event) {
                        totalDels++;
                        checkComplete();
                    };
                }
                for (var n = 0; n < keys.length; n++) {
                    delKey(keys[n])
                }
            });
        },
        onConnectCB: function(cache) { // onConnectCB
            return new Promise(function(resolve, reject) {
                indexedDB.onerror = genericErrorHandler;
                log_dbg("creating DB");
                var request = indexedDB.open(dbname, BACKING_VERSION);

                if(!request) {
                    // did you test with Safari in 'private window' - yeah, won't work
                    log_err("Could not get a indexedDB databased request. Failing",request);
                    reject();
                    return;
                }

                request.onerror = function(event) {
                    reject();
                    log_err("Can't get indexedDB db why??:", event);
                };                    

                var createStore = function(_db) {
                    log_dbg('keystore: ',KEYSTORE);

                    var store = _db.createObjectStore(KEYSTORE, {
                        keyPath: '_key'
                    });
                    // to avoid possible issue from this sort of crap:
                    // https://github.com/axemclion/IndexedDBShim/issues/199
                    store.createIndex('_keyIndex', '_key', {
                        unique: "true"
                    });

                }

                var on_connect_error = function(event) {
                    log_err("Database error: " + event.target.errorCode);
                    reject(event.target.errorCode);
                };

                var doLoad = function() {
                    loadDB(cache).then(function(){
                        resolve(cache);
                    },function(e){
                        log_err("Error during database load:",e);
                        reject(e);
                    }).catch(function(e){
                        log_err("Exception occurred while loading DB:",e);
                        reject(e);
                    });                    
                }

                // what is this?
                // a fix for this crap: 
                // https://github.com/axemclion/IndexedDBShim/issues/121
                var _on_upgrade_fired = false;
                var _fix_wait_timer = null;

                var waitABitForShim = function() {
                    _fix_wait_timer = setTimeout(function(){
                        // wait for the onupgradeneeded to be fired
                        log_dbg("Waiting a bit for indexedDBshim...");
                    },1000);
                }

                request.oncomplete = function(){
                    // not being reached
                    log_dbg("************* GOT oncomplete (2)");
                }

                request.onsuccess = function(event) {
                    log_dbg("makeIndexDBBacking..onsuccess");
                    DB = event.target.result;
                    DB.onerror = on_connect_error;

                    if(!DB.objectStoreNames.contains(KEYSTORE)) {
                        log_err("Warning - missing store in database - looks messed up.");
                        // HACK this should never happen!
                        // oh, but it does - sometimes. with indexeddbshim om iOS
                        if(shimFix && !_on_upgrade_fired) {
                            log_err("Going to wait...");
                            waitABitForShim();
                        }
                    } else {
                        doLoad();
                    }
                };
                // called when the database is first created or when the version requested is newer.
                request.onupgradeneeded = function(evt) {
                    _on_upgrade_fired = true;
                    if(_fix_wait_timer) {
                        clearTimeout(_fix_wait_timer); _fix_wait_timer = null;
                    }
                    log_dbg("makeIndexDBBacking..onupgradeneeded", evt);
                    DB = evt.target.result;
                    // if(!DB.objectStoreNames.contains(KEYSTORE)) {
                    log_dbg("object store not created. creating...");
                    createStore(DB);
                };
            });
        }
    }, {
        id: "indexedDBBack:" + dbname,
        rdThrottle: rdThrottle,
        dlThrottle: dlThrottle,
        wrThrottle: wrThrottle
    });
}
module.exports = makeIndexedDBBacking;