/**
 * THIS TEST FOR IN-BROWSER ONLY
 * Run: [project-root]/test-in-browser.sh
 * Then goto http://localhost:8800/public/backing_store.html
 */


var SmartCache = require('smartcache');
var Promise = require('es6-promise').Promise;

var cache = new SmartCache({
	debug_mode: true
});

var double = function(num) {
	return num*2;
}

var VALS = [];

var updaters_keys = {
	'key1' : 5,
	'key2' : 6,
	'key3' : 7
}

var updater_set_vals_in_cache = function(cache,val) {
	var keyz = Object.keys(updaters_keys);

	for(var n=0;n<keyz.length;n++) {
		_val = val;
		if(val === undefined) {
			cache.set(keyz[n],updaters_keys[keyz[n]]);
		} else {
			if(typeof val === 'function') {
				_val = val(updaters_keys[keyz[n]]);
			}
			updaters_keys[keyz[n]] = _val;
			cache.set(keyz[n],_val);
		}
	}
}

this.backing_store =  {

	'test1' : function(TEST) {

		console.trace("HERE");

		TEST.ok(true,"All ok.");
		var backing = new SmartCache.makeIndexedDBBacking(cache,"testBackingStore",{debug_mode: true});
		console.log("setting backing...",backing);
		cache.setBacking(backing).then(function(){
			console.log("backing ready!!!!!!!!!!");
			doTest();
		});

		var testUpdater = new cache.Updater(function(val,data,key,cache){
			// this - refers to the Updater
			var self = this;
			return new Promise(function(resolve,reject){
				setTimeout(function(){
					console.log("In [testUpdater (" + self.id() + ":" + self._ref + ")].callback - key",key);
					if(val !== undefined) {
						console.log("got a 'set' command");
						updater_set_vals_in_cache();
						resolve();
						return;
					} else {
						console.log("[testUpdater] was a 'selfUpdate' ")
						if(data !== undefined) {
							console.log("  + has data");
							updater_set_vals_in_cache(cache,function(d){
								return d+1;
							})
							resolve();
						} else {
							console.log("  - no data");
							updater_set_vals_in_cache(cache,5);
							resolve();
						}
					}
				},500);
			});
		},function(val,key,cache){
			console.log("Updater saw delete key:",key,"last val was:",val);
			delete updaters_keys[key];
		},
		function(){
			console.trace("[testUpdater] OnShutdown");
		},
		{
			interval: 5000,
			id: 'testUpdater'
		});


		var doTest = function(){
			
			TEST.ok(true,"OK2");

			cache.setData('key1',3,{
				updater: testUpdater
				,ttl: 2000
			});

			cache.setData('key2',3,{
				updater: testUpdater
			});

			cache.setData('key3',3,{
				updater: testUpdater
			});

			// setTimeout(function(){
			// 	cache.setData('key1',6);	
			// },4000);

			// setTimeout(function(){
			// 	cache.setData('key1',7);
			// },6000);
			var RUN = 0;
			var T1 = [];
			T1[0] = 0;
			T1[1] = 0;
			T1[2] = 0;
			T1[3] = 0;
			var printInterval = setInterval(function(){
				console.log("--------------------------");
				var d = cache.getData('key1');
				console.log("key1:",d);
				d.then(function(){
					T1[1]++;
				},function(){
					T1[1]++;
				}).catch(function(e){
					console.error("@catch:",e);
					TEST.ok(false,"@catch ");
				});
				var d = cache.getData('key2');
				console.log("key2:",d);
				d.then(function(){
					T1[2]++;
				},function(){
					T1[2]++;
				}).catch(function(e){
					console.error("@catch:",e);
					TEST.ok(false,"@catch ");
				});
				var d = cache.getData('key3');
				console.log("key3:",d);
				d.then(function(){
					T1[3]++;
				},function(){
					T1[3]++;
				}).catch(function(e){
					console.error("@catch:",e);
					TEST.ok(false,"@catch ");
				});
				(function(t){
					setTimeout(function(){
						T1[0]++;
						for(var n=1;n<4;n++) {
							TEST.ok(T1[0]==T1[n],"Promises completed key"+n+" for run:"+t);
						}	
					},1000);					
				})(RUN);
				console.log("Stats:",cache.getStats());
				RUN++;
			},1500);

			setTimeout(function(){
				console.log("**** removed key1");
				cache.removeData('key1');
			},10000);


			setTimeout(function(){
				clearInterval(printInterval);
				cache.removeData('key2');
				console.log("clearing all of cache.");
				cache.clear();
				console.log("ok - done.");

	     		var ret = cache.getData('key1').then(function(){
					TEST.ok(false,"'key1' should be deleted.");
				},function(){
					TEST.ok(true,"'key1' is deleted.");
				});
	     		console.log("RET=",ret);

				setTimeout(function(){
					for(var n=1;n<4;n++) {
						TEST.ok(T1[0]==T1[n],"Final test: key"+n+" - Promises completed.");
					}

					TEST.ok(true,"@end.");
					TEST.done();
				},1000);		




			},20000);

		}



	}
}



