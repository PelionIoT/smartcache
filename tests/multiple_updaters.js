// test some timeouts

var SmartCache = require('../index.js');

var cache = new SmartCache({
	debug_mode: true
});


var double = function(num) {
	return num*2;
}

var VALS = {
'key1' : 5,
'key2' : 50,
'key3' : 500,
'key4' : 1000
};

var DOGS = {
	'Buster' : {
		type: 'puppy',
		breed: 'mutt',
		weight: 10
	},
	'Bartholomew' : {
		breed: 'great dane',
		type: 'adult',
		weight: 110
	},
	'Yipper' : {
		breed: 'dachshund',
		type: 'senior',
		weight: 15
	}
};

var externalSetFunc = function(key,val) {
	console.log("externalSetFunc(",key,",",val,")");
	VALS[key] = val;
}
var externalDelFunc = function(key,val) {
	console.log("externalDelFunc(",key,")");
	delete VALS[key];
}

var externalGetFunc = function(key) {
	console.log("externalGetFunc(",key,")");
	return VALS[key]; 
}



var externalSetDOG = function(key,val) {
	console.log("externalSetFunc(",key,",",val,")");
	DOGS[key] = val;
}
var externalDelDOG = function(key,val) {
	console.log("externalDelFunc(",key,")");
	delete DOGS[key];
}

var externalGetDOG = function(key) {
	console.log("externalGetFunc(",key,")");
	return DOGS[key]; 
}



var SOMEVAL = 55;

var SAY = function() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift(">> TEST:");
    if(global.log)
        log.debug.apply(log,args);
    else
        console.log.apply(console,args);
};

// nodeunit boiler plate:
if(module)
	module.exports = {};
else {
	var module = {};
	module.exports = {};
}
// nodeunit does not report exceptions
// that's silly, but here is the fix:
module.exports.basic_get_set = function(test) {
	if(global.process) {
		process.on('uncaughtException', function(err) {
		  	console.error("EXCEPTION:",err.stack);
			test.ok(false,"EXCEPTION:"+err.stack);  
			test.done();
		});		
	}
// end boiler plate.
 
	var SmartCache = require('../index.js');

	var cache = new SmartCache({
		debug_mode: true
	});


	var testUpdater = new cache.Updater(function(cache){
		// this - refers to the Updater
		var setkeys = cache.getWriteReqs(); // The `setkeys` is an array of keys which need to be set by the Updater      
		var getkeys = cache.getReadReqs();  // need to get read by the Updater - and then, set() in the cache
		var delkeys = cache.getDelReqs();
		console.log("in [testUpdater] Updater:",this.id()); // this refers to the Updater
		for(var n=0;n<setkeys.length;n++) {
			console.log("[testUpdater] Updating key",setkeys[n]);
			externalSetFunc(setkeys[n],cache.get(setkeys[n])); // or any other arbritrary magic!
			cache.setComplete(setkeys[n]);  // let the cache know this work was completed
		}
		for(var n=0;n<delkeys.length;n++) {
			console.log("[testUpdater] Deleting key",delkeys[n]);
			externalDelFunc(delkeys[n]); // or any other arbritrary magic!
			cache.del(delkeys[n]);
			cache.setComplete(delkeys[n]);	  
		}
		for(var n=0;n<getkeys.length;n++) {
			console.log("[testUpdater] Setting key",getkeys[n]);
			if(getkeys[n] == "something not here") {
		    cache.setFail(getkeys[n]); // you can mark certain keys as failing. So this 'set' failed.
		                               // this is 'fail fast' - note, any key request not marked 
		                               // with `setComplete(key)` is automatically considered failing
		                               // at the end of the call
		  } else {
		      cache.set(getkeys[n],externalGetFunc(getkeys[n])); // or any other arbritrary magic!
		      //cache.setComplete(keys[n]); // can be done, automatically marked as complete when cache.set is called
		  }
		}
		cache.set('newkey',SOMEVAL);  // the updater may also set new keys during the update
		                            // (opportunistic caching)
		return Promise.resolve(); // should always return a Promise - and should resolve() unless
		                        // critical error happened.
	},
	function(){
		console.trace("[testUpdater] OnShutdown");
	},
	{
		interval: 5000,
		id: 'testUpdater'
	});

	var DOGS_SHUTDOWN = false;

	var dogUpdater = new cache.Updater(function(cache){
		// this - refers to the Updater
		var setkeys = cache.getWriteReqs(); // The `setkeys` is an array of keys which need to be set by the Updater      
		var getkeys = cache.getReadReqs();  // need to get read by the Updater - and then, set() in the cache
		var delkeys = cache.getDelReqs();
		console.log("in [dogUpdater] Updater:",this.id()); // this refers to the Updater
		for(var n=0;n<setkeys.length;n++) {
			console.log("[dogUpdater] Updating key",setkeys[n]);
			externalSetDOG(setkeys[n],cache.get(setkeys[n])); // or any other arbritrary magic!
			cache.setComplete(setkeys[n]);  // let the cache know this work was completed
		}
		for(var n=0;n<delkeys.length;n++) {
			console.log("[dogUpdater] Deleting key",delkeys[n]);
			externalDelDOG(delkeys[n]); // or any other arbritrary magic!
			cache.del(delkeys[n]);
			cache.setComplete(delkeys[n]);	  
		}
		for(var n=0;n<getkeys.length;n++) {
			console.log("[dogUpdater] Setting key",getkeys[n]);
			if(getkeys[n] == "something not here") {
		    cache.setFail(getkeys[n]); // you can mark certain keys as failing. So this 'set' failed.
		                               // this is 'fail fast' - note, any key request not marked 
		                               // with `setComplete(key)` is automatically considered failing
		                               // at the end of the call
		  } else {
		      cache.set(getkeys[n],externalGetDOG(getkeys[n])); // or any other arbritrary magic!
		      //cache.setComplete(keys[n]); // can be done, automatically marked as complete when cache.set is called
		  }
		}
		return Promise.resolve(); // should always return a Promise - and should resolve() unless
		                        // critical error happened.
	},
	function(){
		console.trace("[dogUpdater] OnShutdown");
		DOGS_SHUTDOWN = true;
	},
	{
		interval: 5000,
		id: 'dogUpdater'
	});



	SAY("Setting 'key1' with TTL 2000");
	cache.setData('key1',3,{
		updater: testUpdater
		,ttl: 2000
	}).then(function(){
		test.ok(true,"set fulfilled.");
	});

	setTimeout(function(){
		SAY("@2500ms - TTL out - see if data 'key1' updated.");
		cache.getData('key1').then(function(d){
			test.equal(d,3,"test getData after Updater update (post TTL)");
		});
	},2500);

	cache.setData('key2',3,{
		updater: testUpdater
	});


	setTimeout(function(){
		var gotit = null;
		cache.getData('key2').then(function(d){
			gotit = d;
		});
		setTimeout(function(){
			test.ok(gotit !== null,"Test getData fulfilling correclty");
		},200);
	},500)

	cache.setData('key3',3,{
		updater: testUpdater
	});

	cache.setData('Buster',DOGS['Buster'],{
		updater: dogUpdater
	});
	cache.setData('Bartholomew',DOGS['Bartholomew'],{
		updater: dogUpdater
	});
	cache.setData('Yipper',DOGS['Yipper'],{
		updater: dogUpdater
	});


	var dogTestInterval = setInterval(function(){
		cache.getData('Buster').then(function(d){
			test.ok(d.breed,"returned Dog object");
			if(d.age) {
				d.age++;
			} else {
				d.age = 1;
			}
		})

		cache.getData('Bartholomew').then(function(d){
			test.ok(d.breed,"returned Dog object");
			if(d.age) {
				d.age++;
			} else {
				d.age = 5;
			}
		})

		cache.getData('Yipper').then(function(d){
			test.ok(d.breed,"returned Dog object");
			if(d.age) {
				d.age++;
			} else {
				d.age = 11;
			}
		})

	},1000);

	// setTimeout(function(){
	// 	cache.setData('key1',6);	
	// },4000);

	// setTimeout(function(){
	// 	cache.setData('key1',7);	
	// },6000);

	var key1_should_be_deleted = false;


	var showKey = function(key){
		var d = cache.getData(key).then(function(d){
			console.log("OK, "+key+"=",d)		
		});
		console.log("  (Promise) "+key+":",d);
	}

	var printInterval = setInterval(function(){
		console.log("--------------------------");
		var d = cache.getData('key1').then(function(d){
			if(key1_should_be_deleted) test.equal(d,undefined,"Testing deletion of key1");
			console.log("OK, key1=",d)
		});
		console.log("key1:",d);
		showKey('key2');
		showKey('key3');
		showKey('Bartholomew');
		showKey('Buster');
		showKey('Yipper');
		console.log("Stats:",cache.getStats());
	},1000);

	setTimeout(function(){
		console.log("**** removed key1");
		cache.removeData('key1').then(function(){
			test.ok(true,"test removeData()");
			key1_should_be_deleted = true;
			cache.getData('key1').then(function(d){
				console.log("key1 now",d);
				test.ok(d==undefined,"Test deletion.");
			});
		},function(){
			test.ok(false,"Failed to removeData()");
		})
	},10000);

//			test.done();


	setTimeout(function(){
		clearInterval(dogTestInterval);
		var proms = [];
		proms.push(
		cache.removeData('Bartholomew').then(function(){
			test.ok(true,"Deletion happened");
		},function(){
			test.ok(false,"Failure");
		}));
		proms.push(
		cache.removeData('Buster').then(function(){
			test.ok(true,"Deletion happened");
		},function(){
			test.ok(false,"Failure");
		}));
		proms.push(
		cache.removeData('Yipper').then(function(){
			test.ok(true,"Deletion happened");
		},function(){
			test.ok(false,"Failure");
		}));
		Promise.all(proms).then(function(){
			test.ok(true,"All deletions happened");
		}).then(function(){
			var stats = cache.getStats();
			test.ok(stats.numUpdaters == 1,"Should only have one updater left.");
			test.ok(DOGS_SHUTDOWN == true,"The dogUpdater was shutdown - and onShutdown called.");
		},function(){
			test.ok(false,"Failure to delete all dogs.");
		}).catch(function(){
			test.ok(false,"Exception happened in Promsie chain.");
		})
	},15000);



	setTimeout(function(){
		clearInterval(printInterval);	
		cache.removeData('key2');
		cache.getData('key2').then(function(d){
			test.ok(d==undefined,"Test deletion.");
		});
		console.log("clearing all of cache.");
		cache.clear();
		cache.getData('key3').then(function(d){
			test.ok(d==undefined,"Test clear()");
		});
		setTimeout(function(){
			console.log("Wait for test completion.");
			test.done();
		},500)
		console.log("ok - done.");
	},20000);







}

