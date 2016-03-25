/**
 * Created by ed on 3/19/16.
 */
var Promise = require('es6-promise').Promise;

var jsCache = require('js-cache');
var base32 = require('./base32.js');

var log_err = function() {
    if(global.log)
        log.error.apply(log,arguments);
    else {
        var args = Array.prototype.slice.call(arguments);
        args.unshift("ERROR");
        args.unshift("[SmartCache]");
        console.error.apply(console,args);
    }

};

var log_warn = function() {
    if(global.log)
        log.warn.apply(log,arguments);
    else {
        var args = Array.prototype.slice.call(arguments);
        args.unshift("WARN");
        args.unshift("[SmartCache]");
        console.error.apply(console,args);
    }
};

var ON_log_dbg = function() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift(" {"+(new Date).getTime()+"}");
    args.unshift("[SmartCache]");
    if(global.log)
        log.debug.apply(log,args);
    else
        console.log.apply(console,args);
};

var SmartCache = function(opts) {
    var smartcache = this;
    var stats = {
        hits: 0,
        misses: 0,
        updateCalls: 0,
        allGets: 0
    };

    var defaultTTL = undefined;
    var defaultThrottle = 2000;

    var log_dbg = function() {};

    if(opts && typeof opts === 'object') {
        if(opts.debug_mode) log_dbg = ON_log_dbg;
        if(typeof opts.defaultTTL === 'number' && opts.defaultTTL > 0) defaultTTL = opts.defaultTTL;
        if(typeof opts.defaultThrottle === 'number' && opts.defaultThrottle > 0) defaultThrottle = opts.defaultThrottle;
    }

    var cache = new jsCache();

    var backing = null;  // there can be only one Backing per SmartCache

   /**
     * The cacheBackingInterface is passed into the Backing to add keys into the cache.
     * However, any items the Updater manipulates *will use* the given Updater in the future.
     * @param  {[type]} keyForCall The `key` value handed to the updater when this cacheDelegate was also
     * passed in
     * @param  {[type]} updater    The updater using the cacheDelegate
     * @class  cacheDelegate
     */
    var cacheBackingInterface = function(proms){
        var promises = proms;
        var pairs = {};
        this.set = function(key,val){
            if(typeof key === 'string') {
                pairs[key] = val;                
            } else {
                throw new TypeError("Key must be a string");
            }
        }

        this._promises = function() {
            return promises;
        }
        this._pairs = function() {
            return pairs;
        }
    }
    

    /**
     * Provides for a storage backing hooking for the cache.
     * @param {object} callbacks An object with specified callbacks for the Backing interface
     *      {
     *          writeCB: function(pairs) {},
     *          readCB: function(pairs, cache) {},
     *          onConnectCB: function(),
     *          onDisconnectCB: function(),
     *          deserializeCB: function(cache,limit),  // used to load the entire cache for storage
     *          serializeCB: function(cache)     // used to serialize all data in cache.
     *      }
     * `writeCB` A callback which should return a Promise which resolves when the write is complete.
     * The callback is of the form:
     *      function(pairs) {
     *          // pairs is an Array of {key:'key',val:'val'} pairs 
     *          // which should be written to storage
     *      }
     * `readCB` A callback which should return a Promise which resolves when a read is complete.
     *      function(pairs,cache) {
     *          // pairs is an Object of {'key': null} where 'key' should be filled in with the value @ key
     *          // the cache object is provided, the same as handed to the Updater object, to
     *          // all the readCB to provie opportunistic caching if it has new data to hand to the cache
     *          resolve(pairs);
     *      }
     * `onConnectCB` An optional call back which should be called on initialization of the cache.
     * `onDisconnectCB` An optional call back which will be called when the cache goes offline / is `shutdown`
     * @param {object} [opts] If you want the backing to always keep values in cache, use opts.defaultTTL = null;
     */
    this.Backing = function(callbacks,opts) {
        var _selfBacking = this;

        var wrThrottle = null;
        var rdThrottle = null;
        var dlThrottle = null;
        var _id = base32.randomBase32(8);
        var backingTTL = defaultTTL;

        var proper = 0;
        var writeCB,readCB,onConnectCB,onDisconnectCB,serializeCB,deserializeCB;
        if(typeof callbacks === 'object') {
            if(typeof callbacks.writeCB === 'function') {
                writeCB = callbacks.writeCB;
                proper++;
            }
            if(typeof callbacks.readCB === 'function') {
                readCB = callbacks.readCB;
                proper++;
            }
            if(typeof callbacks.deleteCB === 'function') {
                deleteCB = callbacks.deleteCB;
                proper++;
            }            
            if(typeof callbacks.onConnectCB === 'function') {
                onConnectCB = callbacks.onConnectCB;
            }
            if(typeof callbacks.onDisconnectCB === 'function') {
                onDisconnectCB = callbacks.onDisconnectCB;
            }
            if(typeof callbacks.serializeCB === 'function') {
                serializeCB = callbacks.serializeCB;
            }
            if(typeof callbacks.deserializeCB === 'function') {
                deserializeCB = callbacks.deserializeCB;
            }
        }
        if(proper < 3) {
            throw new TypeError("Backing is missing mandatory params or callbacks");
        }

        if(opts && typeof opts === 'object') {
            if(opts.wrThrottle) {
                wrThrottle = opts.wrThrottle;
            }
            if(opts.rdThrottle) {
                rdThrottle = opts.rdThrottle;
            }
            if(opts.id) {
                _id = opts.id;
            }
            if(opts.defaultTTL != undefined) {
                backingTTL = opts.defaultTTL;
            }
        }

        if(!writeCB || typeof writeCB !== 'function'
            || !readCB || typeof readCB !== 'function') {
            throw new TypeError("Missing mandatory parameters");
        }

        this.id = function() {
            return _id;
        }

        writeQ = {};
        writerTimeout = null;
        deleteQ = {};

        this._start = function() {
            if(onConnectCB && typeof onConnectCB === 'function') {
                var ret = onConnectCB();
                if(ret && typeof ret === 'object' && typeof ret.then === 'function') {
                    return ret;
                } else {
                    return Promise.resolve();
                }
            } else {
                return Promise.resolve();
            }
        }


        this._write = function(key,val) {
            var doWrite = function(){
                var tempQ = writeQ;
                writeQ = {};
                writeCB(tempQ).then(function(){
                    log_dbg("_write() complete");
                },function(e){
                    log_err("error on writing to Backing",_id,e);
                }).catch(function(err){
                    log_err("exception on writing to Backing",_id,err);
                });                
            }

            writeQ[key] = val;
            if(wrThrottle) {
                if(writerTimeout) {
                    return;
                } else {
                    writerTimeout = setTimeout(function(){
                        if(writeQ.length > 0)
                            doWrite();
                        writerTimeout = null;
                    },wrThrottle);
                    doWrite();
                }
            } else {
                doWrite();
            }
        };

        this._delete = function(key) {
            var doDelete = function(){
                var tempQ = deleteQ;
                deleteQ = [];
                deleteCB(Object.keys(tempQ)).then(function(){
                    log_dbg("_delete() complete");
                },function(e){
                    log_err("error on writing to Backing",_id,e);
                }).catch(function(err){
                    log_err("exception on writing to Backing",_id,err);
                });                
            }

            deleteQ[key] = 1;
            if(dlThrottle) {
                if(deleteTimeout) {
                    return;
                } else {
                    deleteTimeout = setTimeout(function(){
                        if(deleteQ.length > 0)
                            doDelete();
                        deleteTimeout = null;
                    },dlThrottle);
                    doDelete();
                }
            } else {
                doDelete();
            }
        };

        var readQ = {};
        var readerTimeout = null;
        var promisesTokensByKey = {};

        this._read = function(key) {
            var doRead = function(Q) {
                var tempQ = readQ;
                readQ = {};
                var cache_interface = new cacheBackingInterface(promisesTokensByKey);
                promisesTokensByKey = {};
                readCB(Object.keys(tempQ),cache_interface).then(function(cache_interface){
                    if(!outQ || typeof outQ !== 'object') {
                        log_err("Invalid resolve() from Backing read callback.");
                        var proms = cache_interface._promises();
                        var pairs = cache_interface._pairs();
                        var keyz = Object.keys(pairs);
                        for(var n=0;n<keyz.length;n++) {
                            cache.set(keyz[n],pairs[keyz[n]],backingTTL);
                            if(proms[keyz[n]]) { // fulfill any promises
                               proms[keyz[n]].resolve(pairs[keyz[n]]);
                               delete proms[keyz[n]];
                            }
                        }
                        log_dbg("Backing",_selfBacking.id(),"set",keyz.length,"values");
                        keyz = Object.keys(proms);
                        for(var n=0;n<keyz.length;n++) {
                            proms[keyz[n]].reject();
                        }
                        log_dbg("Backing",_selfBacking.id(),"had",keyz.length,"reject()s");
                    }
                });
            };

            if(promisesTokensByKey[key] && typeof promisesTokensByKey[key] === 'object') {
                return promisesTokensByKey[key].promise;
            } else {
                promisesTokensByKey[key] = {}  
                var ret_prom = promisesTokensByKey[key].promise = new Promise(function(resolve,reject) {
                    promisesTokensByKey[key].resolve = resolve;
                    promisesTokensByKey[key].reject = reject;
                });
            }

            if(!readerTimeout) {
                if(rdThrottle) {
                    readerTimeout = setTimeout(function(){
                        var keyz = Object.keys(readQ);
                        if(keyz.length > 0)
                            doRead();
                        readerTimeout = null;
                    },rdThrottle);
                    doRead();
                } else {
                    doRead();
                }
            }
            return ret_prom;
        }

    };

    this.setBacking = function(_backing) {
        return new Promise(function(resolve,reject){
            if(_backing instanceof smartcache.Backing) {
                _backing._start().then(function(){
                    backing = _backing;
                    resolve();
                },function(e){
                    log_err("Error starting Backing",_backing.id());
                    reject();
                }).catch(function(e){
                    log_err("@catch - exception on backing start():",e);
                })
            } else {
                reject();
                throw new TypeError("Backing must be instance of [smartcache instance].Backing");
            }
        });
    }


    /**
     * The cacheDelegate is passed into the Updater, so the updater can
     * add/remove items to the cache during it's run (opportunistic caching)
     * However, any items the Updater manipulates *will use* the given Updater in the future.
     * @param  {[type]} keyForCall The `key` value handed to the updater when this cacheDelegate was also
     * passed in
     * @param  {[type]} updater    The updater using the cacheDelegate
     * @class  cacheDelegate
     */
    var cacheDelegate = function(updater){
        this._dirty = false;
        this._updater = updater;
        this._writeQ = {}; this._readQ = {}; this._delQ = {};
    }


    cacheDelegate.prototype.isDirty = function() {
        return this._dirty;
    }
    cacheDelegate.prototype.addWriteToken = function(key) {
        // if dlTokenQ[key] ?? 
        // if wrTokenQ[key] ??
        this._dirty = true;
        if(this._writeQ[key]) {
            return this._writeQ[key];
        }
        var token = {
            key: key
         }
        token.promise = new Promise(function(resolve,reject){
            token.resolve = resolve;
            token.reject = reject;
        });
        this._writeQ[key] = token;
        return token;
    }
    cacheDelegate.prototype.addReadToken = function(key) {
        this._dirty = true;
        if(this._readQ[key]) {
            return this._readQ[key];
        }
        var token = {
            key: key
        }
        token.promise = new Promise(function(resolve,reject){
            token.resolve = resolve;
            token.reject = reject;
        });
        this._readQ[key] = token;
        return token;
    }
    cacheDelegate.prototype.addDelToken = function(key) {
        this._dirty = true;
        if(this._delQ[key]) {
            return this._delQ[key];
        }
        var token = {
            key: key
        }
        token.promise = new Promise(function(resolve,reject){
            token.resolve = resolve;
            token.reject = reject;
        });
        this._delQ[key] = token;
        return token;

    }
    cacheDelegate.prototype.sanitizeForUser = function() {
        // this prepares the delegate to go to calling code.\
        // by shadowing out the functions
        this.addDelToken = null;
        this.addReadToken = null;
        this.addWriteToken = null;
    }

    cacheDelegate.prototype.getReadReqs = function() {
        return Object.keys(this._readQ);
    }
    cacheDelegate.prototype.getWriteReqs = function() {
        return Object.keys(this._writeQ);
    }
    cacheDelegate.prototype.getDelReqs = function() {
        return Object.keys(this._delQ);
    }



    // These three function to be used by the Updater implementer:
    cacheDelegate.prototype.set = function(key,val,ttl){
//        log_dbg("cacheDelegate:",key,val,ttl);
        _setData(key,val,ttl,this._updater);
        if(this._readQ[key]) { // readQ - if the data is 'set' by the Updater
                               // then it has accomplished the 'read'
            this._readQ[key].resolve();
 //           delete this._readQ[key];
        }
    }
    cacheDelegate.prototype.get = function(key) {
        return cache.get(key);
    }
    cacheDelegate.prototype.del = function(key) {
        console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");

        var uid = this._updater.id();
        console.log("uid = ",uid);
        deleteTableByKey[key] = 1; // mark to ingore when we get 'del' event
        _deleteKey(key,'updater',uid);
//        smartcache.removeData(key);
        if(this._delQ[key]) { // readQ - if the data is 'set' by the Updater
                              // then it has accomplished the 'read'
            this._delQ[key].resolve();
//            delete this._delQ[key];
        }

//        if(key != this._keyForCall) {
            // smartcache.removeData(key);
//        }
    }
    //     writeQueue,  // the queue used to tell the Updater to set a value at the Updater's end
    //     readQueue,   // the queue for telling the Updater to read a value at the Updater's end
    //                  // i.e read value, and then Updater places it into cache
    //     delQueue     // the queue used to ask the Updater to delete a value 
    //                  // from the Updater's end
    cacheDelegate.prototype.setComplete = function(key) {
        if(this._writeQ[key]) {
            this._writeQ[key].resolve();
            delete this._writeQ[key];
            return;            
        }
        if(this._readQ[key]) {
            this._readQ[key].resolve();
            delete this._readQ[key];
            return;            
        }
        if(this._delQ[key]) {
            this._delQ[key].resolve();
            delete this._delQ[key];
            return;
        }
        throw new ReferenceError("key "+key+" is not in delegate cache.");
    }
    cacheDelegate.prototype.setFail = function(key,e) {
        if(this._writeQ[key]) {
            this._writeQ[key].reject(e);
            delete this._writeQ[key];
            return;            
        }
        if(this._readQ[key]) {
            this._readQ[key].reject(e);
            delete this._readQ[key];
            return;            
        }
        if(this._delQ[key]) {
            this._delQ[key].reject(e);
            delete this._delQ[key];
            return;            
        }
        throw new ReferenceError("key "+key+" is not in delegate cache.");
    }
    // should be called after updater completes
    // this looks for non-complete requests & fails them
    cacheDelegate.prototype._rejectUnhandled = function() {
        var Qs = {w:this._writeQ,r:this._readQ,d:_this.delQ};
        for(var Q in Qs) {
            var keyz = Object.keys(Qs[Q]);
            for(var n=0;n<keyz.length;n++) {
                Qs[Q][keyz[n]].reject();
                delete Qs[Q][keyz[n]];
            }            
        }        
    }


    /**
     * An updater takes a callback. That callback does two things:
     *      function callback(cache) {
     *          var setkeys = cache.getWriteReqs(); // The `setkeys` is an array of keys which need to be set by the Updater      
     *          var getkeys = cache.getReadReqs();  // need to get read by the Updater - and then, set() in the cache
     *          var delkeys = cache.getDelReqs();
     *          console.log("I am Updater:",this.id()); // this refers to the Updater
     *          for(var n=0;n<setkeys.length;n++) {
     *              console.log("Updating key",setkeys[n]);
     *              externalSetFunc(setkeys[n],cache.get(setkeys[n])); // or any other arbritrary magic!
     *              cache.setComplete(keys[n]);  // let the cache know this work was completed
     *          }
     *          for(var n=0;n<delkeys.length;n++) {
     *              console.log("Deleting key",delkeys[n]);
     *              externalDelFunc(delkeys[n]); // or any other arbritrary magic!
     *              cache.setComplete(delkeys[n]);
     *              
     *          }
     *          for(var n=0;n<getkeys.length;n++) {
     *              console.log("Updating key",getkeys[n]);
     *              if(keys[n] == "something not here") {
     *                  cache.setFail(keys[n]); // you can mark certain keys as failing. So this 'set' failed.
     *                                          // this is 'fail fast' - note, any key request not marked 
     *                                          // with `setComplete(key)` is automatically considered failing
     *                                          // at the end of the call
     *              } else {
     *                  cache.set(getkeys[n],externalGetFunc(getkeys[n])); // or any other arbritrary magic!
     *                  //cache.setComplete(getkeys[n]); // can be done, automatically marked as complete when cache.set is called
     *              }
     *          }
     *          cache.set('newkey',someval);  // the updater may also set new keys during the update
     *                                        // (opportunistic caching)
     *          return Promise.resolve(); // should always return a Promise - and should resolve() unless
     *                                    // critical error happened.
     *      }
     * 
     * @param {Function} callback
     * @param {Function} [onDeleteCallback] An optional callback of the form:
     *      function callback(val,key,cache) {}
     * This callback is called when the updater's key is deleted in cache. The `val` is the
     * last `val` in the cache before deletion. The `onDeleteCallback` is optional.
     * @param {Function} [onShutdownCB] This is an optional function which is called when the
     * Updater is no longer needed by any key
     * @param {Object} [opts] Options. If provided, this must be the fourth argument:
     *      {
     *         interval: 60*1000, // an optional refresh interval the Updater should be called
     *                            // if this is called, an no data changes have occurred from the SmartCache
     *                            // perspective, then `setkeys` and `getkeys` are just empty
     *         throttle: 5000,    // only call the updater every 5 seconds, no quicker
     *         id: "someName"     // a specified ID name, otherwise a random new name will be generated
     *                            // useful if replacing an Updater
     *      } The interval the updater should self update if desired.
     * @return {any} Any value, but always return the updated data - even if no change. A return
     * of `undefined` will effectively remove the data from the cache.
     * @constructor
     */
    this.Updater = function(callback,onShutdownCB,opts) {
        var _selfUpdater = this;
        if(typeof callback != 'function') {
            throw new TypeError("Updater only takes [Function]");
        }
        var _cb = callback;
        var _id = base32.randomBase32(8);
        var _shutdownCB = onShutdownCB;

        var _throttleTimer = null;
        var _intervalTimer = null;
        var shutdown = false;
        // var _throttleCbQ = [];

        this.shutdown = function() {
            shutdown = true;
            if(_throttleTimer) {
                clearTimeout(_throttleTimer);
            }
            if(_intervalTimer) {
                clearTimeout(_intervalTimer);
            }
            if(_shutdownCB && typeof _shutdownCB === 'function') {
                _shutdownCB();
            }
        }

        this._ref = 0;

        this.getOpts = function() {
            return options;
        }

        var options = opts;
        var throttle = defaultThrottle;
        if(options) {
            if(typeof options !== 'object') {
                throw new TypeError("Bad parameter.");
            }
            if(options.id) {
                _id = options.id;
                delete options.id;
            }
            if(options.throttle) {
                throttle = options.throttle;
            }
            if(options.interval && typeof options.interval != 'number') {
                throw new TypeError("options.interval must be a number");
            }
            if(options.interval && options.throttle && options.interval < options.throttle) {
                throw new RangeError("options.interval must be > options.throttle");
            }
        } else {
            options = {};
        }

        this.id = function() {
            return _id;
        }


        // var completeWaits_resolve = function(Q,ret) {
        //     log_dbg("completeWaits_resolve");
        //     for(var n=0;n<Q.length;n++) {
        //         Q[n].resolve(ret);
        //     }
        // }
        // var completeWaits_reject = function(Q,err) {
        //                 log_dbg("completeWaits_reject");
        //     for(var n=0;n<Q.length;n++) {
        //         Q[n].reject(err);
        //     }
        // }

        // var rdTokenQ = {};
        // var wrTokenQ = {};
        // var dlTokenQ = {};



        var currentDelgCache = new cacheDelegate(_selfUpdater);

        // these return promises
        this.getData = function(key) {
            var ret = currentDelgCache.addReadToken(key);
            selfUpdate();
            return ret.promise;
        }
        this.setData = function(key) {
            var ret = currentDelgCache.addWriteToken(key);
            selfUpdate();
            return ret.promise;
        }
        this.removeData = function(key) {
            var ret = currentDelgCache.addDelToken(key);
            selfUpdate();
            return ret.promise;
        }


        /** called when an interval expires, or when a value
         * falls out of the cache
         * @param data
         * @returns {*}
         */
        var selfUpdate = function() {


            var doUpdate = function(){
                if(shutdown) {
                    return;
                }
                if(!currentDelgCache.isDirty() && !options.interval) {
                    log_dbg("skipping update, cache not dirty.");
                    return;
                }
//                var tempQ = updateTokenQ;
//                updateTokenQ = {};
                var delg = currentDelgCache;
                currentDelgCache = new cacheDelegate(_selfUpdater);
                _throttleTimer = 1; // this prevents updates from getting run on top of each other
                stats.updateCalls++;
                var ret = _cb.call(_selfUpdater,delg);
                if(ret && typeof ret === 'object' && typeof ret.then === 'function') {
                    ret.then(function(r){
                        if(shutdown) {
                            return;
                        }
                        if(currentDelgCache.isDirty()) {
                            _throttleTimer = setTimeout(function(){
                                log_dbg("THROTTLE: in timeout for throttle");
                                doUpdate();
                            },throttle);
                            log_dbg("THROTTLE: Throttle set, next call in",throttle,"ms");
                        } else {
                            if(options.interval) {
                                _intervalTimer = setTimeout(function(){
                                    log_dbg("INTERVAL: in timeout for interval");
                                    _intervalTimer = null;
                                    doUpdate();
                                },options.interval);
                                log_dbg("INTERVAL: Timer set, next call in",options.interval,"ms");
                            }
                            _throttleTimer = null;
                        }
                        // completeWaits_resolve(_throttleCbQ,r);
                        // _throttleCbQ = [];
                        // _throttleTimer = null;
                    },function(err){
                        if(currentDelgCache.isDirty()) {
                            _throttleTimer = setTimeout(function(){
                                doUpdate();
                            },throttle);
                        } else {
                            if(options.interval) {
                                _intervalTimer = setTimeout(function(){
                                    log_dbg("INTERVAL: in timeout for interval");
                                    _intervalTimer = null;
                                    doUpdate();
                                },options.interval);
                                log_dbg("INTERVAL: Timer set, next call in",options.interval,"ms");
                            }
                            _throttleTimer = null;
                        }

                        // completeWaits_reject(_throttleCbQ,err);
                        // _throttleCbQ = [];
                        // _throttleTimer = null;
                    }).catch(function(e){
                        log_err("Exception in throttled selfUpdate.doUpdate()",e);
                        if(currentDelgCache.isDirty()) {
                            _throttleTimer = setTimeout(function(){
                                doUpdate();
                            },throttle);
                        } else {
                            if(options.interval) {
                                _intervalTimer = setTimeout(function(){
                                    log_dbg("INTERVAL: in timeout for interval");
                                    _intervalTimer = null;
                                    doUpdate();
                                },options.interval);
                                log_dbg("INTERVAL: Timer set, next call in",options.interval,"ms");
                            }                            
                            _throttleTimer = null;
                        }


                        // completeWaits_reject(_throttleCbQ,e);
                        // _throttleCbQ = [];
                        // _throttleTimer = null;
                    });
                } else {
                    log_err("Update must primary callback must return a promise.");
                    var delg = new cacheDelegate(_selfUpdater);
                }
            }

            if(_throttleTimer !== null) { // Already in montion: a callback is running or just ran, 
                                 // still in throttle window
                return;
            } else {
                if(_intervalTimer) {
                    // if we are also waiting on an interval, clear it
                    // (it will get reset after this call completes)
                    log_dbg("Canceling INTERVAL");
                    clearTimeout(_intervalTimer);
                }
                doUpdate();
            }
        }

    }



    var updaterTableByKey = {}; // by key name : Updater.id
    var timerTable = {};   // by Updater.id

    var updatersById = {}; // all updaters, by ID


    var WaitQueue = function() {
        this._queue = [];
    }
    WaitQueue.prototype.resolve = function(D) {
        for(var n=0;n<this._queue.length;n++) {
            this._queue[n].resolve(D);
        }
    }
    WaitQueue.prototype.reject = function(D) {
        for(var n=0;n<this._queue.length;n++) {
            this._queue[n].reject(D);
        }
    }
    WaitQueue.prototype.add = function(delegate) {
        if(typeof delegate === 'object' &&
            typeof delegate.resolve === 'function' &&
            typeof delegate.reject === 'function')
            this._queue.push(delegate);
        else 
            log_err("MALFORMED data in WaitQueue.");
    }

    var deleteTableByKey = {}; // this table marks a key, if it's explicity deleted.
                               // we use this track to if a key is deleted vs. just 
                               // falling out of the cache
    var pendingByKey = {};  // a map by Key, of WaitQueue objects. each entry is an object of


    var queueForNotifyByKey = function(key,resolve,reject) {
        if(!pendingByKey[key]) {
//            pendingByKey[key] = new WaitQueue();
//  Note: at this point, a WaitQueue should be created - as soon as 
//  the key falls out of cache. If not - then it never existed
            return false;
        }
        pendingByKey[key].add({
            resolve: resolve,
            reject: reject
        });
        return true;
    }


    var removeUpdater = function(u_id) {
        if(u_id) {
            var u = updatersById[u_id];
            if(u) {
                u._ref--;
                log_dbg("Decreasing Updater:",u_id,"ref count to",u._ref);
                if(u._ref < 1) {
                    log_dbg("Removing Updater:",u_id);
                    var tid = timerTable[u_id];
                    if(tid !== undefined) {
                        clearTimeout(tid);
                        delete timerTable[u_id];
                    }
                    updatersById[u_id].shutdown();
                    delete updatersById[u_id];
                }
            }
        }
    }

    var getUpdaterByKey = function(key) {
        var u_id = updaterTableByKey[key];
        if(u_id) {
            var u = updatersById[u_id];
            return u;
        }
        return null;
    }

    // var makeTimeoutForKey = function(key,updater) {
    // var makeGetTimeoutForKey = function(key,updater) {
    //     var timeout = updater.getOpts().interval;


//         var timeout = updater.getOpts().interval;
//         if(timeout && timeout > 0) { // if timeout is set
//             updater._intervalCB = function(key,updater){
//                 log_dbg("** doing update for",key);
// //                var data = cache.get(key);
//                 var data = updater.selfUpdate();
//                 if(data && typeof data === 'object' && typeof data.then === 'function') {
//                     data.then(function() {  
//                         // the cache is already updated via the delegate
//                         var d = cache.get(key);
//                         if(d !== undefined) {
//                             // and reset interval
//                             timerTable[updater.id()] = setTimeout(updater._intervalCB,timeout);                            
//                         }
//                         // if(rdata != undefined) {
//                         //     cache.set(key,rdata,defaultTTL);
//                         //     if(backing) {
//                         //         backing._write(key,rdata);
//                         //     }
//                         //     // and reset interval
//                         //     timerTable[updater.id()] = setTimeout(updater._intervalCB,timeout);
//                         // } else {
//                         //     smartcache.removeData(key);
//                         // }                    
//                     },function(e){
//                         log_err("got a reject() from Updater!");
//                         // log_dbg("Got reject form Updater. Data gone. delete from cache.")
//                         // if(backing) {
//                         //     backing._delete(key).then(function(){ // delete from storage first to prevent race
//                         //         smartcache.removeData(key);                    
//                         //     },function(e){
//                         //         log_err("Error on _delete from Backing:",e);
//                         //     });                            
//                         // } else {
//                         //     smartcache.removeData(key);
//                         // }
//                     }).catch(function(e){
//                         log_err("@catch:",e);
//                     });
//                 } else {
//                     if(data != undefined) {
//                         cache.set(key,data,defaultTTL);
//                         if(backing) {
//                             backing._write(key,data);
//                         }
//                         // and reset interval
//                         timerTable[updater.id()] = setTimeout(updater._intervalCB,timeout);
//                     } else {
//                         smartcache.removeData(key);
//                     }                    
//                 }
//             }.bind(undefined,key,updater);
//             // if timeout exists, remove?
//             var tid = timerTable[updater.id()];
//             if(tid !== undefined) {
//                 clearTimeout(tid);
//             }
//             tid = setTimeout(updater._intervalCB,timeout);
//             timerTable[updater.id()] = tid;
//         } else {
//             log_dbg("Updater",updater.id(),"has no interval. Clearing any existing");
//             var tid = timerTable[updater.id()];
//             if(tid !== undefined) {
//                 clearTimeout(tid);
//                 delete timerTable[updater.id()];
//             }
//         }
    // }

    var addUpdater = function(key,updater) {
        if(key && updater && updater instanceof smartcache.Updater) {
//            removeUpdater(updater.id()); // remove an old updater with same ID if it exists
            updaterTableByKey[key] = updater.id();
            updater._ref++;
            log_dbg("Adding updater:",updater.id(),"(ref =",updater._ref+")");
            updatersById[updater.id()] = updater;

            // makeTimeoutForKey(key,updater);
        } else {
            throw new TypeError("Bad parameter - needs [string],[Updater:Object]");
        }
    }


    /**
     * Internal _setData is used by the cacheDelegate
     * @private
     * @param {[type]} key     [description]
     * @param {[type]} val     [description]
     * @param {[type]} ttl     [description]
     * @param {[type]} updater [description]
     */
    var _setData = function(key,val,ttl,updater) {
        if(ttl == undefined && defaultTTL) {
            ttl = defaultTTL;
        }
        cache.set(key,val,ttl);
        updaterTableByKey[key] = updater.id();
        if(backing) {
            backing._write(key,rdata);
        }
    }

    // internal delete. This should happen
    // on any delete key
    // @param {String} source who asked for delete: 'updater' or 'user'
    var _deleteKey = function(key,source,updaterid) {
        var u_id = updaterTableByKey[key];
        var u = getUpdaterByKey(key);
        if(u && ((source != 'updater') || 
            (updaterid != u_id))) {
            log_dbg("here1",updaterid,u_id);
            // the 'key' has an updater AND
            // if its NOT an updater calling, or its an Updater updating something
            // for which its not the Updater (whew)
            deleteTableByKey[key] = 1; // mark to ingore when we get 'del' event
            return u.removeData(key).then(function(){ // NOTE: it is the Updater's responsibility
                                                      // to actually remove it from cache

            }); 
        } else {
                        log_dbg("here2");
            if(u_id) {
                delete updaterTableByKey[key];
                removeUpdater(u_id);             
            }
    //        var waits = pendingByKey[key];
            cache.del(key);
            if(backing) {
                return backing._delete(key);
            } else {
                return Promise.resolve();
            }            
        }
        // if(waits) {
        //     // So, if people were waiting on this to update, and 
        //     // meanwhile you delete, just reject all the pending Promises
        //     waits.reject(); 
        // }

    }

    /**
     * Sets data in cache.
     * A word on Updaters. If the Updater is set, it will used to update the data after the
     * data is set in the cache.
     * @param key
     * @param val
     * @param  {Object} [opts] Options are:
     *     {
     *        ttl: 1000, // the TTL timeout in milliseconds. If not
     *                   // set the cache will never go old
     *        updater: myUpdater  // an instance of an Updater
     *     }
     * @param updater
     * @return {Promise} A Promise which fulfills when the Updater sets the data, or otherwise fulfills
     * immediately.
     */
    this.setData = function(key,val,opts) {
        var updater = undefined;
        var ttl = undefined;
        if(typeof opts === 'object') {
            if(opts.updater !== undefined) {
                if(opts.updater instanceof smartcache.Updater) updater = opts.updater;
            } else {
                throw new TypeError("Bad option. option.updater must be an Updater");
            }
            if(typeof opts.ttl === 'number' && opts.ttl > 0)
                ttl = opts.ttl;
        } else if(defaultTTL) {
            ttl = defaultTTL;
        }
        var u_id = null;
        var existing = cache.get(key);
        if(!existing && updater) {
            addUpdater(key,updater);
        }
        if(!updater) {
            updater = getUpdaterByKey(key);
        }
        // update value in cache
        cache.set(key,val,ttl);
        if(updater) {
            return updater.setData(key).then(function(){
                if(backing) {
                    backing._write(key,val);
                }
            });
        } else {
            return Promise.resolve();
        }

        // if(existing != undefined && !updater) {
        //     // it's an existing entry and it does not
        //     // have a new updater
        //     var u = getUpdaterByKey(key);
        //     if(u) {
        //         // if it has an existing Updater
        //         // use it
        //         var retupdater = u.setData(key);
        //         return retupdater
        //     } 
        // } else {
        //     // It's a exiting entry
        //     // with a new updater
        //     if(existing != undefined && updater) {            
        //         // it might have had an old updater, get rid of it
        //         var u_id = updaterTableByKey[key];
        //         if(u_id) removeUpdater(u_id);     
        //         // add new updater   
        //         addUpdater(key,updater);
        //         // and run that new updater to add the data
        //         return updater.then(function(){
        //             if(backing) {
        //                 backing._write(key,val);
        //             }
        //         });
        //     } else if (updater) {
        //         addUpdater(key,updater);
        //         // and run that new updater to add the data
        //     } 
        // }

        // // default case:
        // var u = getUpdaterByKey(key);
        // if(u) {
        //     log_dbg("Unreachable???");
        //     return u.setData(key).then(function(){
        //         if(backing) {
        //             backing._write(key,val);
        //         }                
        //     }) // tell Updater to update its data (will use the cached value)
        // }
        // log_dbg("default setData, backing:",backing);
        // if(backing) {
        //     backing._write(key,val);
        // }
        // return Promise.resolve();


    };


    /**
     * Gets data from the cache.
     * @param {String} key A string of the key caller wants
     * @param {object} [opts] Options are:
     *     {
     *         prefer: 'storage'  // | 'updater' - If prefer 'storage' and the key is not in cache
     *                            // then the backing store will be used if available and it has the key
     *                            // otherwise an updater will be tried (default, if backing is present)
     *                            // If prefer 'updater' then the backing store will be ignored
     *     }
     * @return {Promise} which resolves if the data is retrieved. If the data can not be
     * retrieved then the Promise rejects. If the data is just `undefined`, the Promise resolves with `undefined`.
     */
    this.getData = function(key,opts) {
        stats.allGets++;
        var d = cache.get(key);
        if(d !== undefined) {
            stats.hits++;
            // if its in cache, fast-track it
            return Promise.resolve(d);
        }
        var prefer = null;
        if(opts && opts.prefer) {
            prefer = opts.prefer;
        }
        return new Promise(function(resolve,reject) {
            // why twice? (also above)
            // b/c there is a slight chance that data could have made it into  
            // cache b/t these execution moments.
            var d = cache.get(key);
            if(d !== undefined) {
                stats.hits++;
                resolve(d);
                return;
            }
            if(prefer == 'updater' || !backing) {
                log_dbg("   -> prefer says ignore backing storage");
                var u = getUpdaterByKey(key);
                if(u) {
                    log_dbg("Key",key,"not in cache but have updater. Updating.");
                    u.getData(key).then(function(){
                        resolve(cache.get(key));
                    },function(err){
                        log_err("Error back from Updater - no backing.",err);
                        reject(err);
                    }).catch(function(e){
                        log_err("@catch ",e);
                        reject(e);
                    });
                } else {

                    //FIXME FIXME -->

                    log_dbg("   no Updater, no Data! [",key,"]");
                    // no updater, no data, just nothing:
                    resolve();
                }

                // // if(!queueForNotifyByKey(key,resolve,reject)) {
                //     log_dbg("no key:",key);
                //     reject(); // no data for that key
                //     return;
                // }
            } else {
                log_dbg("trying backing for:",key);
                backing._read(key).then(function(r){
                    resolve(r);
                    // TODO: run updater anyway?
                    // we had to use the backing to get the value, but since it was asked for
                    // should it be updater?
                },function(err){
                    log_dbg("   -> !! no answer from storage. trying updater.");
                    var u = getUpdaterByKey(key);
                    log_dbg("Key",key,"not in cache but have updater. Updating.");
                    if(u) {
                        u.getData(key).then(function(){
                            resolve(cache.get(key));
                        },function(err){
                            log_err("Error back from Updater - no backing.",err);
                            reject(err);
                        }).catch(function(e){
                            log_err("@catch ",e);
                            reject(e);
                        });
                    } else {
                        // no updater, no data, just nothing:
                        resolve();
                    }
                    // if(!queueForNotifyByKey(key,resolve,reject)) {
                    //     log_dbg("no key or updater for:",key);
                    //     reject(); // no data for that key
                    // }
                }).catch(function(e){
                    log_err("@catch - error",e);
                    reject();
                });
                stats.misses++;
            }
        });
    }

    this.removeData = function(key) {
        var uid = undefined;
        var u = getUpdaterByKey(key);
        if(u) uid = u.id();
        return _deleteKey(key,'user',uid);
    }

    // handle events - if an entry is kicked out of cached, its updater
    // needs to run
    
    cache.on('del',function(key){
        if(!deleteTableByKey[key]) {
            log_dbg("Key falling out of cache:",key);
            return;
        }
        var ttl = undefined;
        if(defaultTTL) {
            ttl = defaultTTL;
        }
        log_dbg("Saw cache (real)delete of key:",key);
        if(deleteTableByKey[key]) {
            var u_id = updaterTableByKey[key];
            if(u_id) {
                var u = updatersById[u_id];
                var ret = u.removeData(key);

                // if(ret && typeof ret === 'object' && typeof ret.then === 'function') {
                //     // got a Promsie - so wait until complete.
                //     log_dbg("Updater returned Promise - will wait for it.");
                //     if(!pendingByKey[key]) {
                //         pendingByKey[key] = new WaitQueue();
                //     }
                //     // make the WaitQueue - so that when other looks for this key
                //     // they know that a value is being retrieved.
                //     ret.then(function(result){
                //         log_dbg("pending: got resolve for key",key);
                //         cache.set(key,ret,ttl);
                //         var waitQ = pendingByKey[key];
                //         if(waitQ) {
                //             waitQ.resolve(result);
                //         }
                //         delete pendingByKey[key];
                //     },function(err){
                //         log_dbg("pending: got reject! for key",key);
                //         if(err) {
                //             log_err("Got error in pending updater:",err);
                //         }
                //         var waitQ = pendingByKey[key];
                //         if(waitQ) {
                //             waitQ.reject(result);
                //         }
                //         delete pendingByKey[key];
                //     }).catch(function(err){
                //         log_err("An exception / error occurred in updater:",err);
                //         var waitQ = pendingByKey[key];
                //         if(waitQ) {
                //             waitQ.reject(result);
                //         }
                //         delete pendingByKey[key];
                //     });
                // } else {
                //     log_err("Bad response from Updater",u_id);
                // }
            }
            delete deleteTableByKey[key];
        } else {
            // just remove from delete table - do nothing else.
            delete deleteTableByKey[key];
        }
    });


    this.clear = function() {
        // release all timers. clear all cache.
        cache.clear();
        var timers = Object.keys(timerTable);
        for(var n=0;n<timers.length;n++) {
            clearTimeout(timerTable[timers[n]]);
            delete timerTable[timers[n]];
        }
        var updaters = Object.keys(updatersById);
        for(var n=0;n<updaters.length;n++) {
            updatersById[updaters[n]].shutdown();
            delete updatersById[updaters[n]];
        }

        deleteTableByKey = {}; 
        pendingByKey = {};  
        updaterTableByKey = {};
        timerTable = {};
        updatersById = {};
    }




    this.getStats = function() {
        stats.cacheSize = cache.size();
        stats.numUpdaters = Object.keys(updatersById).length;
        return stats;
    }

    this.getDumpString = function() {

    }

}

module.exports = SmartCache;
module.exports.makeIndexedDBBacking = require('./indexedDBBacking.js');
