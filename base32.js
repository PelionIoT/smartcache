

//var alphabet = '0123456789abcdefghjkmnpqrtuvwxyz'
var alphabet =   '0123456789ABCDEFGHJKMNPQRTUVWXYZ'
var alias = { O:0, I:1, L:1, S:5 };
var table = {};
var numTable = [];

//var makeStrRepeat = function(n,c) {
//	var s = "";
//	for(var p=0;p<n;p++) {
//		s += c;
//	}
//	return s;
//};





var replaceAt=function(str,index, character) {
    return str.substr(0, index) + character + str.substr(index+character.length);
}

var onlyLeadingTrailingWSre = /^[\s]*([\S]+)[\s]*$/;


// NOTE: we removed '5' in the Relay alphabet factory generator recently and replaced it with '0'
var validRelayPairingCodeCharsRE = /^[\s]*([ABCDEFGHIJKMNPQRSTUVWXYZ234567890]+)[\s]*$/;
var validRelayPairingCodeExactRE = /^[\s]*([ABCDEFGHIJKMNPQRSTUVWXYZ234567890]{25})[\s]*$/;

var relay_chars_alias = {
    '1':'I',
    'O':'0'
//    '5':'S' // don't uncomment until we are in production
};

var replaceAlphabet = function(_in,alias) {
    var ret = _in;
    for (var n=0;n<_in.length;n++) {
        var P = _in.charAt(n);
        var c = alias[P];
        if(c !== undefined) {
            ret = replaceAt(ret,n,c);
        }
    }
    return ret;
};

var validateRelayPairingCode = function(s) {
    var out = s.toUpperCase();
    out = replaceAlphabet(out,relay_chars_alias);
    var m = validRelayPairingCodeExactRE.exec(out);
    if(m && m.length > 0) {
        out = m[1];
        return out;
    } else {
        return null;
    }
};

var validRelayPairingCodeChars = function(s) {
    var out = s.toUpperCase();
    out = replaceAlphabet(out,relay_chars_alias);
    var m = validRelayPairingCodeCharsRE.exec(out);
    if(m && m.length > 0) {
        out = m[1];
        return out;
    } else {
        return null;
    }
};


/**
 * Validates our Base32 string. Returns a compliant base32 string, along with the alias
 * conversions. If the string is not a valid Base32, it returns null;
 * @param str
 * @returns {null}
 */
var validateBase32String = function(str) {
    var out = str.toUpperCase();
    var m = onlyLeadingTrailingWSre.exec(out);
    if(m && m.length > 0) {
        out = m[1]; // remove trailing and leading WS
        for(var n=0;n<out.length;n++) {
            var P = out.charAt(n);
            var c = table[P];
            if(c !== undefined) {
                if(alias[P] !== undefined) {
                    out = replaceAt(out,n,alphabet[alias[P]]); // replace aliases
                }
            } else {
                return null;
            }
        }
        return out;
    } else {
        return null;
    }
};

var randomBase32 = function(len)
{
    if(len < 1) {
        return "";
    }
    var text = "";
    var possible = alphabet;

    for( var i=0; i < len; i++ )
        text += possible.charAt(Math.floor(Math.random() * possible.length));

    return text;
};

/// <summary>
/// Converts the given decimal number to the numeral system with the
/// specified radix (in the range [2, 36]).
/// </summary>
/// <param name="decimalNumber">The number to convert.</param>
/// <param name="radix">The radix of the destination numeral system (in the range [2, 36]).</param>
/// <returns></returns>
var DecimalToArbitrarySystem = function(decimalNumber, radix, table)
{
    var BitsInLong = 64;
//    var Digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
	var Digits = table;

    if (radix < 2 || radix > Digits.Length)
         throw new Error("The radix must be >= 2 and <= " + Digits.Length.ToString());

    if (decimalNumber == 0)
        return "0";

    var index = BitsInLong - 1;
    var currentNumber = decimalNumber; //Math.Abs(decimalNumber);
//    char[] charArray = new char[BitsInLong];
//	var charArray = new Array(BitsInLong);
//	var charArray = makeStrRepeat(BitsInLong,'0');
	var outStr = "";

    while (currentNumber != 0)
    {
        var remainder = (currentNumber % radix);
        // console.log('remainder='+remainder);
        // console.log("digits="+Digits[remainder]);
        outStr = Digits[remainder] + outStr;
        currentNumber = Math.floor(currentNumber / radix);
    }

//    var result = new String(charArray, index + 1, BitsInLong - index - 1);
    if (decimalNumber < 0)
    {
        outStr = "-" + outStr;
    }

    return outStr;
}

var ArbitrarySystemToDecimal = function(arbNum, radix, dictionary) {
	var ret = 0;
	var str = new String(arbNum);

	for(var n=0;n<str.length;n++) {
		var c = str.charAt(str.length-n-1);
		var v = dictionary[c];
		if(v > 0)
			ret = ret + v*Math.pow(radix,n);
	}

	return ret;

}


for (var i = 0; i < alphabet.length; i++) {
	table[alphabet[i]] = i
}

var k = Object.keys(table);
for(var n=0;n<k.length;n++)
	numTable[n] = k[n];

// Splice in 'alias'
for (var key in alias) {
 	if (!alias.hasOwnProperty(key)) continue;
 	table[key] = table['' + alias[key]];
}

//console.dir(table);
//console.dir(numTable);
var toBase32 = function(number,digits) {

	var baseNumber = DecimalToArbitrarySystem(number,32,numTable);

    if(typeof digits == 'number') {
        while(baseNumber.length != digits) {
            baseNumber = '0' + baseNumber;
        }
    }

    return baseNumber;
};

var fromBase32 = function(base32num) {
	return ArbitrarySystemToDecimal(base32num.toUpperCase(),32,table);
};

/*var examples = [ 0, 31, 313, 11110000, 1091212012, 120120, 99999999, 33, 32, 32*32 ];

for(var n=0;n<examples.length;n++) {
	var v = toBase32(examples[n]);
	console.log('' + examples[n] + " = " + v +"[b32]" + " = " + fromBase32(v));
}*/

module.exports = {
    toBase32: toBase32,
    fromBase32: fromBase32,
    validateBase32: validateBase32String,
    validateRelayPairingCode: validateRelayPairingCode,
    validRelayPairingCodeChars: validRelayPairingCodeChars,
    randomBase32: randomBase32
};
