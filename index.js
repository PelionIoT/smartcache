/**
 * Created by ed on 3/19/16.
 */

var jsCache = require('js-cache');
var base32 = require('./base32.js');

var log_err = function() {
    if(global.log)
        log.error.apply(undefined,arguments);
    else {
        var args = Array.prototype.slice.call(arguments);
        args.unshift("ERROR");
        args.unshift("[SmartCache]");
        console.error.apply(undefined,args);
    }

};

var log_warn = function() {
    if(global.log)
        log.warn.apply(undefined,arguments);
    else {
        var args = Array.prototype.slice.call(arguments);
        args.unshift("WARN");
        args.unshift("[SmartCache]");
        console.error.apply(undefined,args);
    }
};

var ON_log_dbg = function() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift(" {"+(new Date).getTime()+"}");
    args.unshift("[SmartCache]");
    if(global.log)
        log.debug.apply(undefined,args);
    else
        console.log.apply(undefined,args);
};

var SmartCache = function(opts) {
    var smartcache = this;
    var stats = {
        hits: 0,
        misses: 0,
        updates: 0,
        allGets: 0
    };

    var defaultTTL = undefined;

    var log_dbg = function() {

    };

    if(opts && typeof opts === 'object') {
        if(opts.debug_mode) log_dbg = ON_log_dbg;
        if(typeof opts.defaultTTL === 'number' && opts.defaultTTL > 0) defaultTTL = opts.defaultTTL;
    }

    var cache = new jsCache();


    /**
     * The cacheDelegate is passed into the Updater, so the updater can
     * add/remove items to the cache during it's run (opportunistic caching)
     * However, any items the Updater manipulates *will use* the given Updater in the future.
     * @param  {[type]} keyForCall The `key` value handed to the updater when this cacheDelegate was also
     * passed in
     * @param  {[type]} updater    The updater using the cacheDelegate
     * @class  cacheDelegate
     */
    var cacheDelegate = function(keyForCall,updater){
        this._keyForCall = keyForCall;
        this._updater = updater;
    }
    cacheDelegate.prototype.set = function(key,val,ttl){
        // if(key == this._keyForCall) {
        //     if(ttl === undefined) {
        //         ttl = defaultTTL;
        //     }
        //     cache.set(arguments[0],arguments[1],ttl);
        // } else {
        //     smartcache.setData(key,val,{
        //         ttl: ttl,
        //         updater: this._updater
        //     });
        // }
        _setData(key,val,ttl,this._updater);
    }
    cacheDelegate.prototype.get = function(key) {
        return cache.get(key);
    }
    cacheDelegate.prototype.del = function(key) {
//        if(key != this._keyForCall) {
            smartcache.removeData(key);
//        }
    }

    /**
     * An updater takes a callback. That callback does two things:
     *      function callback(val,data,key,cache) {
     *          data = data + val; // or any other arbritrary magic!
     *          console.log("this data belongs to key:",key);
     *          // I could use the cache to update other stuff now if 
     *          // I needed to...
     *          return data;
     *          // OR - it may return a Promise which will fulfill to the data
     *          return new Promise(function(){ resolve(data); });
     *      }
     * If `val` is `undefined` then the `callback` must update the data in question
     * using another means, typically a network service or similar. If `val` is
     * passed in, then the callback must update the data using the value. The updated
     * data will always be returned. The `data` passed in is the existing `data` before
     * the update. This may or may not be useful to the caller.
     * Opportunistic caching: The `cache` is passed in, because in some cases an updater may
     * wish to update other values as well, since the operation it does gives it
     * opportunity to update other values.
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
     *         id: "someName"     // a specified ID name, otherwise a random new name will be generated
     *                            // useful if replacing an Updater
     *      } The interval the updater should self update if desired.
     * @return {any} Any value, but always return the updated data - even if no change. A return
     * of `undefined` will effectively remove the data from the cache.
     * @constructor
     */
    this.Updater = function(callback,onDeleteCallback,onShutdownCB,opts) {
        var _selfUpdater = this;
        if(typeof callback != 'function') {
            throw new TypeError("Updater only takes [Function]");
        }
        var _cb = callback;
        var _deleteCb = onDeleteCallback;
        var _id = base32.randomBase32();
        var _shutdownCB = onShutdownCB;

        this.shutdown = function() {
            if(_shutdownCB && typeof _shutdownCB === 'function') {
                _shutdownCB();
            }
        }

        var options = opts;
        if(options) {
            if(typeof options !== 'object') {
                throw new TypeError("Bad parameter.");
            }
            if(options.id) {
                _id = options.id;
                delete options.id;
            }
        } else {
            options = {};
        }

        /** called when an interval expires, or when a value
         * falls out of the cache
         * @param data
         * @returns {*}
         */
        this.selfUpdate = function(data,key) {
            var delg = new cacheDelegate(key,_selfUpdater);
            return _cb.call(_selfUpdater,undefined,data,key,delg);
        }
        this.set = function(val,data,key){
            var delg = new cacheDelegate(key,_selfUpdater);
            return _cb.call(_selfUpdater,val,data,key,delg);
        }
        this.setDelete = function(val,key) {
            var delg = new cacheDelegate(key,_selfUpdater);
            if(_deleteCb) _deleteCb.call(_selfUpdater,val,key,delg);
        };

        this._ref = 0;

        this.getOpts = function() {
            return options;
        }
        this.id = function() {
            return _id;
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


    var makeTimeoutForKey = function(key,updater) {
        var timeout = updater.getOpts().interval;
        if(timeout && timeout > 0) { // if timeout is set
            updater._intervalCB = function(key,updater){
                log_dbg("** doing update for",key);
                var data = cache.get(key);
                data = updater.selfUpdate(data,key);
                if(data != undefined) {
                    cache.set(key,data,defaultTTL);
                    // and reset interval
                    timerTable[updater.id()] = setTimeout(updater._intervalCB,timeout);
                } else {
                    smartcache.removeData(key);
                }
            }.bind(undefined,key,updater);
            // if timeout exists, remove?
            var tid = timerTable[updater.id()];
            if(tid !== undefined) {
                clearTimeout(tid);
            }
            tid = setTimeout(updater._intervalCB,timeout);
            timerTable[updater.id()] = tid;
        } else {
            log_dbg("Updater",updater.id(),"has no interval. Clearing any existing");
            var tid = timerTable[updater.id()];
            if(tid !== undefined) {
                clearTimeout(tid);
                delete timerTable[updater.id()];
            }
        }
    }

    var addUpdater = function(key,updater) {
        if(key && updater && updater instanceof smartcache.Updater) {
//            removeUpdater(updater.id()); // remove an old updater with same ID if it exists
            updaterTableByKey[key] = updater.id();
            log_dbg("Adding updater:",updater.id());
            updater._ref++;
            updatersById[updater.id()] = updater;            
//            var opts = updater.getOpts();
            makeTimeoutForKey(key,updater);
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
    }

    /**
     * Sets data in cache.
     * A word on Updaters. If the Updater is set, it will used to update the data when
     * the cache timesout, and will be used to set the data in the future, if setData
     * is called without a new Updater passed in, when the key already exists. It will
     * to used the data during this initial call as well.
     * @param key
     * @param val
     * @param  {Object} [opts] Options are:
     *     {
     *        ttl: 1000, // the TTL timeout in milliseconds. If not
     *                   // set the cache will never go old
     *        updater: myUpdater  // an instance of an Updater
     *     }
     * @param updater
     */
    this.setData = function(key,val,opts) {
        var updater = undefined;
        var ttl = undefined;
        if(typeof opts === 'object') {
            if(opts.updater instanceof smartcache.Updater) updater = opts.updater;
            if(typeof opts.ttl === 'number' && opts.ttl > 0)
                ttl = opts.ttl;
        } else if(defaultTTL) {
            ttl = defaultTTL;
        }

        var e = cache.get(key);
        if(e != undefined && !updater) {
            // it's an existing entry and it does not
            // have a new updater
            var u_id = updaterTableByKey[key];
            if(u_id) {
                var u = updatersById[u_id];
                if(u) {
                    // stop a timeout, if its running
                    var tid = timerTable[u_id];
                    if(tid !== undefined) {
                        clearTimeout(tid);
                        delete timerTable[u_id];
                    }
                    // update value
                    var v = u.set(val,e,key);
                    if(v !== undefined) {
                        cache.set(key,v,ttl);
                        if(u.getOpts().interval) {
                            makeTimeoutForKey(key,u);
                        }
                    } else {
                        // a return value of undefined from the updater
                        // means delete key
                        log_dbg("updater says delete key:",key);
                        cache.del(key);
                        removeUpdater(u_id);
                    }
                }
            }
        } else {
            // It's a new entry, or an old entry
            // with a new updater

            // simple case: just set the value
            cache.set(key,val,ttl);           
            // if there is an updater, add it
            if(updater) {
                if(e !== undefined) {
                    // it might have had an old updater, get rid of it
                    var u_id = updaterTableByKey[key];
                    removeUpdater(u_id);
                }
                addUpdater(key,updater);
            }
        }
    };


    /**
     * Gets data from the cache.
     * @param key
     * @return {Promise} which resolves if the data is retrieved. If the data can not be
     * retrieved then the Promise rejects. If the data is just `undefined`, the Promise resolves with `undefined`.
     */
    this.getData = function(key) {
        stats.allGets++;
        var d = cache.get(key);
        if(d !== undefined) {
            stats.hits++;
            // if its in cache, fast-track it
            return Promise.resolve(d);
        }
        return new Promise(function(resolve,reject) {
            // why twice? (also above)
            // b/c there is a slight chance that data could have made it into  
            // cache b/t these execution moments.
            var d = cache.get(key);
            if(d !== undefined) {
                resolve(d);
                return;
            }
            stats.misses++;
            if(!queueForNotifyByKey(key,resolve,reject)) {                
                log_dbg("no key:",key);
                reject(); // no data for that key
                return;
            }
            log_dbg("Key",key,"not in cache but have updater. Updating.");
        });
    }

    this.removeData = function(key) {

        var u_id = updaterTableByKey[key];
        var u = updatersById[u_id];
        if(u) {
            var e = cache.get(key);
            u.setDelete(e,key);
        }
        deleteTableByKey[key] = 1;
        cache.del(key);
        removeUpdater(u_id);
        var waits = pendingByKey[key];
        if(waits) {
            // So, if people were waiting on this to update, and 
            // meanwhile you delete, just reject all the pending Promises
            waits.reject(); 
        }
    }


    // handle events - if an entry is kicked out of cached, its updater
    // needs to run
    
    cache.on('del',function(key){
        var ttl = undefined;
        if(defaultTTL) {
            ttl = defaultTTL;
        }
        log_dbg("Saw cache delete of key:",key);
        if(!deleteTableByKey[key]) {
            var u_id = updaterTableByKey[key];
            if(u_id) {
                var u = updatersById[u_id];
                var ret = u.selfUpdate(undefined,key);
                if(ret && typeof ret === 'object' && typeof ret.then === 'function') {
                    // got a Promsie - so wait until complete.
                    log_dbg("Updater returned Promise - will wait for it.");
                    if(!pendingByKey[key]) {
                        pendingByKey = new WaitQueue();
                    }
                    // make the WaitQueue - so that when other looks for this key
                    // they know that a value is being retrieved.
                    ret.then(function(result){
                        var waitQ = pendingByKey[key];
                        if(waitQ) {
                            waitQ.resolve(result);
                        }
                        delete pendingByKey[key];
                    },function(err){
                        var waitQ = pendingByKey[key];
                        if(waitQ) {
                            waitQ.reject(result);
                        }
                        delete pendingByKey[key];
                    }).catch(function(err){
                        log_err("An exception / error occurred in updater:",err);
                        var waitQ = pendingByKey[key];
                        if(waitQ) {
                            waitQ.reject(result);
                        }
                        delete pendingByKey[key];
                    });
                } else {
                    cache.set(key,ret,ttl);
                }
            } else {
                log_dbg("Looks like a key was orphaned (no updater):",key);
            }
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