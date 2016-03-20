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
        console.error.apply(undefined,args);
    }

};

var log_warn = function() {
    if(global.log)
        log.warn.apply(undefined,arguments);
    else {
        var args = Array.prototype.slice.call(arguments);
        args.unshift("WARN");
        console.error.apply(undefined,args);
    }
};

var ON_log_dbg = function() {
    //var args = Array.prototype.slice.call(arguments);
    //args.unshift("WebDeviceSim");
    if(global.log)
        log.debug.apply(undefined,arguments);
    else
        console.log.apply(undefined,arguments);
};

var SmartCache = function(opts) {

    var log_dbg = function() {

    };

    if(opts.debug_mode) {
        log_dbg = ON_log_dbg;
    }

    var cache = new jsCache();

    /**
     * An updater takes a callback. That callback does two things:
     *      function callback(val,data,cache) {
     *          data = data + val; // or any other arbritrary magic!
     *          return data;
     *      }
     * If `val` is null then the `callback` must update the data in question
     * using another means, typically a network service or similar. If `val` is
     * passed in, then the callback must update the data using the value. The updated
     * data will always be returned. The `data` passed in is the existing `data` before
     * the update. This may or may not be useful to the caller.
     * Opportunistic caching: The `cache` is passed in, because in some cases an updater may
     * wish to update other values as well, since the operation it does gives it
     * opportunity to update other values.
     * @param {Function} callback
     * @param {Function} [onDeleteCallback] An optional callback of the form:
     *      function callback(val) {}
     * This callback is called when the updater's key is deleted in cache. The `val` is the
     * last `val` in the cache before deletion. The `onDeleteCallback` is optional.
     * @param {number} [interval] The interval the updater should self update if desired.
     * @return {any} Any value, but always return the updated data - even if no change. A return
     * of `undefined` will effectively remove the data from the cache.
     * @constructor
     */
    this.Updater = function(callback,onDeleteCallback,interval) {
        if(typeof callback != 'function') {
            throw new TypeError("Updater only takes [Function]");
        }
        var _cb = callback;

        /** called when an interval expires, or when a value
         * falls out of the cache
         * @param data
         * @returns {*}
         */
        this.selfUpdate = function(data) {
            return _cb(null,data,cache);
        }
        this.set = function(val,data){
            return _cb(val,data,cache);
        }
        this._id = base32.randomBase32();
        this._ref = 0;
    }



    var updaterTableByKey = {}; // by key name : Updater.id
    var timerTable = {};   // by Updater.id

    var updatersById = {}; // all updaters, by ID


    var removeUpdater = function(u_id) {
        if(u_id) {
            var u = updatersById[u_id];
            if(u) {
                u._ref--;
                if(u._ref < 1) {
                    delete updatersById[u_id];
                    var tid = timerTable[u_id];
                    if(tid !== undefined) {
                        clearInterval(tid);
                        delete timerTable[u_id];
                    }
                }
            }
        }
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
     *        updater:   // an instance of an Updater
     *     }
     * @param updater
     */
    this.setData = function(key,val,opts) {
        var updater = undefined;
        var ttl = undefined;
        if(typeof opts === 'object') {
            if(typeof opts.updater === 'object') updater = opts.updater;
            if(typeof opts.ttl === 'number' && opts.ttl > 0)
                ttl = opts.ttl;
        }

        var e = cache.get(key);
        if(e != undefined && !updater) {
            // it's an existing entry and it does not
            // have a new updater
            var u_id = updaterTableByKey[key];
            if(u_id) {
                var u = updatersById[u_id];
                if(u) {
                    var v = u.set(val,e);
                    if(v !== undefined) {
                        cache.set(key,v);
                    } else {
                        // a return value of undefined from the updater
                        // means delete key
                        log_dbg("updater says delete key:",key);
                        cache.del(key);
                    }
                }
            }
        } else {
            // It's a new entry, or an old entry
            // with a new updater
            if(updater) {
                if(e !== undefined) {
                    // it might have had an old updater, get rid of it
                    var u_id = updaterTableByKey[key];
                    removeUpdater(u_id);
                }
            } else {
                // simple: just set the value
                cache.set(key,val,ttl);
            }
        }



    };


    /**
     * Gets data from the cache.
     * @param key
     * @return {Promise} which resolves if the data is retrieved. If the data is absent
     * the Promise rejects. If the data is just null, the Promise resolves with null.
     */
    this.getData = function(key) {
        return new Promise(function(resolve,reject) {



        });
    }

    this.removeData = function(key) {

    }

}