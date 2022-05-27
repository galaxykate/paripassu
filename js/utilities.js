
try {
	let simplex = new SimplexNoise()
	
	function noise() {

		switch(arguments.length) {
			case 0: return 0
			case 1: return simplex.noise2D(arguments[0], 100)
			case 2: return simplex.noise2D(...arguments)
			case 3: return simplex.noise3D(...arguments)
			case 4: return simplex.noise4D(...arguments)
			default: console.warn("Too many arguments for noise, max 4", arguments)
		}
	}

	noise.seed = function(seed) {
		console.log("Set noise seed = ", seed)
		simplex = new SimplexNoise(seed)
		let s = []
		for (var i = 0; i < 10; i++) {
			s.push(noise(i).toFixed(2))
		}
		console.log("\tsample:" + s.join(" "))
	}

	
} catch (err) {
	console.warn(err)
	console.warn("No noise implementation included")
}

// // https://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid
// function uuidv4() {
//   return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
//     (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
//   );
// }


function missingKeys(newObj, oldObj) {
	return Object.keys(newObj).filter(key => oldObj[key] === undefined)
}


function polarOffset(p, r, theta) {
		return [p[0] + r*Math.cos(theta), p[1] + r*Math.sin(theta)]
	}
			
function getKey(obj, filter) {
	for (let key in obj) {
		if (obj.hasOwnProperty(key))
			if (filter(key,obj[key]))
				return key
	}
}
function getRandom(arr) {
	return arr[Math.floor(Math.random()*arr.length)]
}

function forKeyIntersection({a, b, fxnA, fxnBoth, fxnB}) {
	let keys0 = Object.keys(a)
	let keys1 = Object.keys(b)
	
	for (var i = 0; i < keys0.length; i++) {
		let k = keys0[i];
		if (b.hasOwnProperty(k)) {
			fxnBoth(k,a[k],b[k]);
		} else {
			fxnA(k,a[k]);
		}
	}

	for (var i = 0; i < keys1.length; i++) {
		let k = keys1[i];
		if (a.hasOwnProperty(k)) {
			//fxnBoth(k);
		} else {
			fxnB(k, b[k]);
		}
	}
}

function forIntersection({a, b, fxnA, fxnBoth, fxnB}) {
	for (var i = 0; i < a.length; i++) {
		let k = a[i];
		let index = b.indexOf(k)
		if (index >= 0) {
			fxnBoth(k, i, index);
		} else {
			fxnA(k, i);
		}
	}

	for (var i = 0; i < b.length; i++) {
		let k = b[i];
		if (a.includes(k)) {
			// skip it, we dealt with it already
		} else {
			fxnB(k, i);
		}
	}
}


function lerpBetween({x, x0, x1, y0, y1, pow=1}) {
	let pct = Math.min(1, Math.max(0, (x - x0)/(x1 - x0)))
	pct = Math.pow(pct, 1)
	return y0 + pct*(y1 - y0)	
}

// Colors
function colorToRGB(v) {
	// https://stackoverflow.com/questions/2353211/hsl-to-rgb-color-conversion
	
	let h = v[0]
	let s = v[1]
	let l = v[2]
	var r, g, b;

	if(s == 0){
		r = g = b = l; // achromatic
	} else {
		var hue2rgb = function hue2rgb(p, q, t){
			if(t < 0) t += 1;
			if(t > 1) t -= 1;
			if(t < 1/6) return p + (q - p) * 6 * t;
			if(t < 1/2) return q;
			if(t < 2/3) return p + (q - p) * (2/3 - t) * 6;
			return p;
		}

		var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
		var p = 2 * l - q;
		r = hue2rgb(p, q, h + 1/3);
		g = hue2rgb(p, q, h);
		b = hue2rgb(p, q, h - 1/3);
	}

	return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];

}

function colorToHex(v) {
	let rgb = colorToRGB(v)
	function componentToHex(c) {
		var hex = c.toString(16);
		return hex.length == 1 ? "0" + hex : hex;
	}

	return "#" + componentToHex(rgb[0]) + componentToHex(rgb[1]) + componentToHex(rgb[2]);
}

	

//=====================================================
// Color

// Hex to HSLA conversion adapted from
// https://css-tricks.com/converting-color-spaces-in-javascript/
// But now it returns an array

function hexToHSL(H) {
	// Convert hex to RGB first
	let r = 0, g = 0, b = 0;
	if (H.length == 4) {
		r = "0x" + H[1] + H[1];
		g = "0x" + H[2] + H[2];
		b = "0x" + H[3] + H[3];
	} else if (H.length == 7) {
		r = "0x" + H[1] + H[2];
		g = "0x" + H[3] + H[4];
		b = "0x" + H[5] + H[6];
	}
	// Then to HSL
	r /= 255;
	g /= 255;
	b /= 255;
	let cmin = Math.min(r,g,b),
	cmax = Math.max(r,g,b),
	delta = cmax - cmin,
	h = 0,
	s = 0,
	l = 0;

	if (delta == 0)
		h = 0;
	else if (cmax == r)
		h = ((g - b) / delta) % 6;
	else if (cmax == g)
		h = (b - r) / delta + 2;
	else
		h = (r - g) / delta + 4;

	h = Math.round(h * 60);

	if (h < 0)
		h += 360;

	l = (cmax + cmin) / 2;
	s = delta == 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
	s = +(s * 100).toFixed(1);
	l = +(l * 100).toFixed(1);
	return [h, s, l]
}

function HSLToHex(h,s,l) {

	// s /= 100;
	// l /= 100;

	let c = (1 - Math.abs(2 * l - 1)) * s,
	x = c * (1 - Math.abs((h / 60) % 2 - 1)),
	m = l - c/2,
	r = 0,
	g = 0, 
	b = 0; 

	if (0 <= h && h < 60) {
		r = c; g = x; b = 0;
	} else if (60 <= h && h < 120) {
		r = x; g = c; b = 0;
	} else if (120 <= h && h < 180) {
		r = 0; g = c; b = x;
	} else if (180 <= h && h < 240) {
		r = 0; g = x; b = c;
	} else if (240 <= h && h < 300) {
		r = x; g = 0; b = c;
	} else if (300 <= h && h < 360) {
		r = c; g = 0; b = x;
	}
	// Having obtained RGB, convert channels to hex
	r = Math.round((r + m) * 255).toString(16);
	g = Math.round((g + m) * 255).toString(16);
	b = Math.round((b + m) * 255).toString(16);

	// Prepend 0s, if necessary
	if (r.length == 1)
		r = "0" + r;
	if (g.length == 1)
		g = "0" + g;
	if (b.length == 1)
		b = "0" + b;

	return "#" + r + g + b;
}



function distanceBetween(v0, v1) {
	return Math.sqrt((v1[0] - v0[0])**2 + (v1[1] - v0[1])**2)
}

function getRandom(arr) {
	return arr[Math.floor(arr.length*Math.random())]
}

//return this.replace(/[^a-z ]/ig, '').replace(/(?:^\w|[A-Z]|\b\w|\s+)/g,..
// With my modifications
function camelize(str) {
	return str.replace(/(-|_|\-)/g, ' ').replace(/[^\w\s]|_/g, "").replace(/(?:^\w|[A-Z]|\b\w|\s+)/g, function(match, index) {
		if (+match === 0) return ""; // or if (/\s+/.test(match)) for white spaces
		return index === 0 ? match.toLowerCase() : match.toUpperCase();

	});
}

function mapObject(obj, fxn, skipUndefined) {

	let obj2 = {}
	for (var key in obj) {
		let val =  fxn(obj[key], key)
		if (val !== undefined || !skipUndefined)
			obj2[key] = val
	}
	return obj2
}

// https://stackoverflow.com/questions/2450954/how-to-randomize-shuffle-a-javascript-array
/* Randomize array in-place using Durstenfeld shuffle algorithm */
function shuffleArray(array) {
	for (var i = array.length - 1; i > 0; i--) {
			var j = Math.floor(Math.random() * (i + 1));
			var temp = array[i];
			array[i] = array[j];
			array[j] = temp;
	}
	return array
}

function drawRandom(array, min, max) {
	let count = Math.floor(Math.random()*(max-min) + min)
	if (max === undefined)
		count = min

	let arr2 = array.slice(0)
	let arr = shuffleArray(arr2).slice(0,count)
	return arr
}

// for (var i = 0; i < 3; i++) {
// 	let s = `${getRandom(testGrammar.greeting)}, ${getRandom(testGrammar.color)} ${getRandom(testGrammar.animal)}!`
// 	if (i == 0)
// 		s = "hello, white cat"

// 	console.log(s)
// 	console.log(detectGrammarMatch(testGrammar, `#color# #animal#`, s))
// 	console.log(detectGrammarMatch(testGrammar, `#greeting#.*#animal#`, s))
// }

function detectGrammarMatch(grammar, rule, s) {

	let rx = ruleToRegex(rule, grammar)
	let match = s.match(new RegExp(rx, "i"));
	return match
}

function ruleToRegex(rule, grammar) {
	
	let sections = rule.split("#")
	return sections.map((s,sindex) => {
		if (sindex %2 == 0) {
			// Plaintext
			return s
		} else {
			 let rules = grammar[s]
			 return `(${rules.join('|')})`
		}
	}).join("")
}


let words = {
	rng: Math.random,
	getRandom(arr) {
		

		return arr[Math.floor(arr.length*this.rng())]
	},

	handEmoji: ("🤲 👐 🙌 👏 🤝 👍 👎 👊 ✊ 🤛 🤜 🤞 ✌️ 🤟 🤘 👌 🤏 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐 🖖 🤙 💪 🖕 ✍️ 🙏 💅 🤝 🤗 🙋‍♀️ 🙆‍♂️ 🤦‍♂️").split(" "),
	emoji: ("😎 🤓 😍 😀 😭 😡 😳 😱 😈 😺 👎 👍 🎃 🤖 👻 ☠️ 👽 👾 🤠 ✍️ 👀 🧠 👩‍🚀 🧝‍♀️ 🦹‍♂️ 🧙‍♀️ 👸 👩‍💻 🕵️‍♀️ 🧶 🧵 👗 🥼 👕 👘 👖 👠 👞 🧤 🧦 🧢 🎩 👑 💍 👓 🕶 🥽 🐶 🐱 🐭 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐣 🦆 🦅 🦉 🦇 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🦟 🐢 🐍 🕷 🦂 🐍 🦎 🦖 🐙 🦑 🦞 🦀 🐋 🦈 🐟 🐬 🐡 🐊 🐅 🐆 🦓 🦍 🐘 🦛 🦏 🐪 🐫 🦒 🦘 🐃 🐂 🐄 🐎 🐖 🐏 🐑 🦙 🐐 🦌 🐕 🐩 🐈 🐓 🦃 🦚 🦜 🦢 🐇 🦝 🦡 🐁 🐀 🐿 🦔 🐾 🐉 🌵 🎄 🌲 🌳 🌴 🌱 🌿 ☘️ 🍃 🍂 🍁 🍄 🐚 🌾 🌷 🥀 🌺 🌹 🌸 🌼 🌻 🌞 🌛 ⭐️ 💫 🌟 ✨ ⚡️ ☄️ 💥 🔥 🌪 🌈 ☀️ ☁️ 🌧 🌩 ❄️ ☃️ 💨 💧 💦 ☂️").split(" "),

	syllables: {
		first: "M N K R L P S T B P T T T N M M M B C D F G Ph J K L M N P Qu R S T V W X Y Z St Fl Bl Pr Kr Ll Chr Sk Br Sth Ch Dhr Dr Sl Sc Sh Thl Thr Pl Fr Phr Phl Wh".split(" ").map(s => s.toLowerCase()),
		middle: "an un in ikl op up an on een a e ie as att it ot out ill all ar ir er od ed ack ock ax ox off is it in im am om all aff en em aw an ad in an on ion ill oop ack ist all ar art air aean eun eun euh esqu aphn arl ifn ast ign agn af av ant app ab er en eor eon ent enth iar ein irt ian ion iont ill il ipp in is it ik ob ov orb oon ion uk uf un ull urk".split(" "),
		composites: "estr antr okl ackl".split(" "),
		last: "ant ent art ert e a i ie ei a a ae ea e e ea a ae ea e e ea a ae ea e e e y yay oy y a ia ea u y as en am us is art on in ath oll an o ang ing io i el ios ius ae ie ee i".split(" "),
		lastVerb: "ade ay ate ify ize ant ise y aze ise int ard ord ip".split(" "),
	},
	title: ["the #placeAdj# #place#", "#firstName#'s #adventure#", "#place# of #stuff#", "#occupation# and the #occupation#"],
	wordSets: ["occupation", "flavor", "musicGenre", "instrument", "color", "material", "adventure","firstName", "lastName", "object", "objAdj", "action", "placeAdj", "place", "stuff", "animal", "mood"],
	instrument: ["ukulele", "vocals", "guitar", "clarinet", "piano", "harmonica", "sitar", "tabla", "harp", "dulcimer", "violin", "accordion", "concertina", "fiddle", "tamborine", "bagpipe", "harpsichord", "euphonium"],
	musicGenre: ["metal", "electofunk", "jazz", "salsa", "klezmer", "zydeco", "blues", "mariachi", "flamenco", "pop", "rap", "soul", "gospel", "buegrass", "swing", "folk"],
	occupation: ["professor", "inventor", "spy", "chef", "hacker", "artist", "sculptor", "insurance salesman", "fashion designer", "web developer", "game programmer", "lumberjack", "firefighter", "scientist", "spy", "wizard", "radio broadcaster", "smuggler", "mechanic", "astronaut", "adventurer", "pirate", "cowboy", "vampire", "detective", "soldier", "marine", "doctor", "ninja", "waitress", "burlesque dancer", "ballerina", "opera singer", "gogo dancer", "rollerskater"],
	flavor : ["special", "dark", "light", "bitter", "burnt", "savory", "flavorful", "aromatic", "fermented", "herbal", "pleasant", "harsh", "smoky", "sweet", "fresh", "refreshing", "somber", "bright", "perky", "sullen", "acidic", "sour", "peaty", "juicy", "perfumed", "buttery", "lush", "brisk", "strong", "weak", "tart", "tangy", "bold", "overpowering", "light", "faint", "subtle", "bright", "zesty", "austere", "round", "big", "buttery", "oaky", "peaty", "seedy", "gritty", "creamy", "smooth", "rustic", "complex", "chewy", "sweet", "crisp", "dense", "bold", "elegant", "sassy", "opulent", "massive", "wide", "flamboyant", "fleshy", "approachable", "jammy", "juicy", "refined", "silky", "structured", "steely", "rich", "toasty", "burnt", "velvety", "unctuous", "oily"],
	firstName: ["Steve", "Michael", "Michaela", "Bob", "Chloe", "Zora", "Nikki", "Nia", "Sal", "Greta", "Zola", "Miki", "Kendra", "Kyle", "Mike", "Rob", "April", "Gregory", "Nathaniel", "Jim", "Arnav", "Noah", "Daniel", "David", "Cindy", "Stella", "Jonathan", "Gabriel", "Lucia", "Hollis", "Holly", "Maisie", "Jasper", "Lane", "Lincoln", "Sterling", "Summer", "Miranda", "Maria", "Shane", "Min", "Minnie", "Mariah", "Gus", "Dani", "Darius", "Elena", "Eduardo", "Elías", "Rajesh", "Ranjit", "Rex", "Rez", "Rey", "Yew", "Reba", "Jae-woo", "Ken", "Kira", "Jae", "Shah", "Josef", "Jørn", "Autumn", "Brandy", "Copper", "Cooper", "Harrow", "Manhattan", "Jo", "Jodi", "Karim", "Raf", "January", "Aku", "Juraj", "Yuri", "Kåre", "Lyn", "Jahan", "Mitch", "Alda", "Aimee", "Zoe", "London", "Paris", "Zuzu", "Zara", "Micah", "Song", "Sparrow", "Miguel", "Mikey", "Monette", "Michelina", "Agave", "Robyn", "Saffron", "Zeke", "Garth", "Rae", "Sebastian", "Seb", "Jake", "Bastion", "Luna", "Apple", "Delilah", "Jeremiah", "Finn", "Milo", "Finley", "April", "May", "September", "Kim", "Phineas", "Quincy", "Saul", "Rudy", "Cleo", "Noel", "Frankie", "June", "Rocky", "Pearl", "Harris", "Braxton", "Hamilton", "Ace", "Duke", "Rowan", "Stella", "Stevie", "Juniper", "Ryder", "Kai", "Judd", "Rhody", "Rho", "Sven", "Hazel", "Byron", "Edie", "Lola", "Poppy", "Jo", "Whisper", "Kaya", "Karim", "Kit", "Luca", "Rafa", "Miriam", "Aya", "Carmen", "Omar", "Anika", "Shan", "Luka", "Theo", "Emma", "Julian", "Adrian", "Ari", "Noah", "Maya", "Ariel"],
	lastName: ["Stevens", "Chao", "Fillmore", "García", "Bond", "Bogg", "Wong", "Wei", "Goldsmith", "Tran", "Chu", "Baudin", "Montagne", "Moulin", "Villeneuve", "Victor", "Rodríguez", "Smith", "Johnson", "Williams", "Miller", "Stockton", "Patel", "Chaudri", "Jahan", "Christiansen", "Whittington", "Austen", "Johnson", "Cheval", "McCulloch", "Shane", "Jones", "Stein", "Hirviniemi", "Kiuru", "Øvregard", "Singh", "Noriega", "Pine", "Clarion", "Belden", "Jaware", "Keita", "Kanu", "Geary", "Norton", "Kearny", "Aliyev", "Sato", "Tanaka", "Kim", "Lee", "Gray", "Yang", "Li", "Çelik", "Davis", "Knox", "Griffin", "Leon", "Finch", "Yoo", "Gupta", "Flores", "Lopez", "Moon", "Sun", "Castro", "Suzuki", "Torres", "Pineda", "Tsao", "Romero", "Wolf"],
	object: ["kettle", "table", "chair", "desk", "lamp", "vase", "urn", "candelabra", "lantern", "idol", "orb", "book", "basket", "hammer", "flowerpot", "bicycle", "paintbrush", "goblet", "bottle", "jar", "toaster", "teacup", "teapot", "rug","basket", "thimble", "ottoman", "cushion", "pen", "pencil", "mug","egg", "chair", "sun", "cloud", "bell", "bucket", "lemon", "glove", "moon", "star", "seed", "card", "pancake", "waffle", "car", "train", "spoon", "fork", "potato"],
	objAdj: ["wooden","old","vintage","woven", "antique","broken","tiny", "giant", "little", "upside-down","dented","imaginary","glowing","curséd","glittery","organic", "rusty", "multi-layered", "complicated", "ornate", "dusty", "gleaming", "fresh", "ancient", "forbidden", "milky", "upholstered", "comfortable", "dynamic", "solar-powered", "coal-fired", "warm", "cold", "frozen", "melted", "boxy", "well-polished", "vivid", "painted", "embroidered", "enhanced", "embellished", "collapsible", "simple", "demure"],
	action: ["sing", "become", "come", "leave", "remain", "see", "look", "behold", "cry", "sleep", "love", "dance", "betray", "need"],
	preposition: ["for", "until", "before", "up", "on", "above", "below", "against", "upon", "inside", "outside", "in"],

	article: ["any", "no", "one", "her", "his", "our", "my", "your", "the", "every"],
	placeAdj: ["great", "tiny", "biggest", "oldest", "worst", "best", "windy","wasted", "drunken", "gleaming",  "knowing", "beloved", "all-seeing", "forgiving", "betraying", "forgotten", "western", "eastern", "starlit", "forgotten", "lost", "haunted", "blessed", "remembered","forsaken", "unknowing", "innocent", "short-lived", "loving", "rejoicing", "fearful", "experienced", "vengeful", "forgiving", "joyful", "mournful", "sorrowful", "angry", "cruel", "fierce", "unbent", "broken", "unbroken", "foolish", "bewildered", "curious", "knowing", "everliving", "everloving", "hard-hearted", "careless", "carefree",  "bright", "dangerous", "fearless", "open-hearted", "generous", "prideful", "foolhardy", "brave", "bold", "wise", "wizened", "old", "young"],
	place: ["room", "sea", "room", "forest", "pagoda", "waste", "temple", "sanctuary", "ocean", "wall", "parlor", "hall", "dungeon", "cave", "sky", "house", "mountain", "sanctum", "palace", "river", "place", "desert", "island", "castle", "house", "inn", "tavern", "tower", "oasis", "tent"],
	stuff: ["stone", "sorrow","eyes", "flowers", "time", "fog", "sun", "clouds", "music", "songs", "stories", "tales", "storms", "rhyme", "freedom", "rhythm", "wind", "life", "ice", "gold", "mysteries", "song", "waves", "dreams", "water", "steel", "iron", "memories", "thought", "seduction", "remembrance", "loss", "fear", "joy", "regret", "love", "friendship", "sleep", "slumber", "mirth"],
	animal: "cobra okapi moose amoeba mongoose capybara yeti dragon unicorn sphinx kangaroo boa nematode sheep quail goat corgi agouti zebra giraffe rhino skunk dolphin whale bullfrog okapi sloth monkey orangutan grizzly moose elk dikdik ibis stork finch nightingale goose robin eagle hawk iguana tortoise panther lion tiger gnu reindeer raccoon opossum".split(" "),
	mood: "vexed indignant impassioned wistful astute courteous benevolent convivial mirthful lighthearted affectionate mournful inquisitive quizzical studious disillusioned angry bemused oblivious sophisticated elated skeptical morose gleeful curious sleepy hopeful ashamed alert energetic exhausted giddy grateful groggy grumpy irate jealous jubilant lethargic sated lonely relaxed restless surprised tired thankful".split(" "),
	color: "ivory silver ecru scarlet red burgundy ruby crimson carnelian pink rose grey pewter charcoal slate onyx black mahogany brown green emerald blue sapphire turquoise aquamarine teal gold yellow carnation orange lavender purple magenta lilac ebony amethyst jade garnet".split(" "),
	material: "fire water cybernetic steampunk jazz steel bronze brass leather pearl cloud sky great crystal rainbow iron gold silver titanium".split(" "),
	adventure: "lament cry wail tale myth story epic tears wish desire dance mystery enigma drama path training sorrows joy tragedy comedy riddle puzzle regret victory loss song adventure question quest vow oath tale travels".split(" "),
	witchName: "Gertrude Baba Hildebrand Ingrid Morgana Morraine".split(" "),

	capitaliseFirstLetter: function(s) {
		return s[0].toUpperCase() + s.substring(1)
	},

	getRandomCode: function() {
		let code = this.getRandom(this.colors) + " " + this.getRandom(this.material) + " " + this.getRandom(this.object)
		return code	
	},

	getRandomWord: function() {
		let src = this[this.getRandom(srcs)]
		let word = this.getRandom(src)
		return word
	},

	getRandomSentence: function(count) {
		count = count || Math.floor(this.rng()*10 + 1)
		let srcs = ["firstName", "lastName", "mood", "color", "material", "objAdj", "object", "place", "stuff", "adventure", "animal", "placeAdj"]
		let words = []
		for (var i = 0; i < count; i++) {
			let src = this[this.getRandom(srcs)]
			let word = this.getRandom(src)
			words.push(word)
		}

		return this.capitaliseFirstLetter(words.join(" ")) + ".";
	},
	getRandomParagraph: function(count = 8) {
		let s = []
		for (var i = 0; i < count; i++) {
			s.push(this.getRandomSentence())
		}
		return s.join(" ");
	},
	getRandomSeed: function(count = 8) {
		let s = ""
		for (var i = 0; i < count; i++) {
			if (this.rng() > .5) {
				s += String.fromCharCode(Math.floor(this.rng() * 26 + 65))
			} else {
				s += String.fromCharCode(Math.floor(this.rng() * 10 + 48))

			}
		}
		return s;
	},

	
	getHumanName: function() {
		let s = this.getRandom(this.firstName);
		s += " " + this.getRandom(this.lastName);
		if (this.rng() > .8) {
			return this.capitaliseFirstLetter(this.getRandom(this.animal)) + " " + this.getRandom(this.lastName)
		}
		if (this.rng() > .8) {
			return this.capitaliseFirstLetter(this.getRandom(this.animal)) + " "  +this.getRandom(this.firstName)
		}
		if (this.rng() > .8) {
			return this.getRandom(this.firstName) + Math.floor(this.rng()*2000)
		}
		return s
	},
	getObject: function() {
		let s = this.getRandom(this.object);
		
		if (this.rng() > .9) {
			return s + " of " + this.getRandom(this.stuff)
		}
		if (this.rng() > .3) {
			let adj = this.getRandom(["color", "material", "placeAdj", "mood", "objAdj", "objAdj"])
			return  this.getRandom(this[adj]) +  " " + s
		}
		
		return s
	},



	getUserName: function() {
		
		let sections = []
		let count = Math.floor(this.rng()**2*3 + 1)
		for (var i = 0; i < count; i++) {
			let s = this.getRandomWord(this.rng()**2*3)
			if (this.rng() > .4) {
				let set = words.getRandom(["object", "objAdj", "firstName", "lastName", "animal", "mood", "color", "material", "adventure", "place", "stuff"])
				if (!this[set])
					console.warn(set)
				s = this.getRandom(this[set])

			}
			s = s.toLowerCase()
			if (this.rng() > .8)
				s = this.capitaliseFirstLetter(s)

			sections[i] = s
		}
		
		let s = sections.join("");
		if (s.length < 10 && this.rng() > .5)
			s += Math.floor(this.rng()*2000)
		if (s.length < 6)
			s += this.getRandomWord(1).toUpperCase()
		s = s.substring(0,15)
		if (s.length < 8)
			s += Math.floor(this.rng()**2*2000)
		return s
	},

	getStatement: function() {
		return "This " + this.getRandom(this.moods) + " " + this.getRandom(this.adventures) + " made me " + this.getRandom(this.moods);
	},

	getRandomTimestamp: function(startTime, timeFromNow) {
		let date = new Date(startTime + this.rng()*timeFromNow) 

		return date.toLocaleString()
	},

	getRandomPlace: function() {
		let adj = this.capitaliseFirstLetter(this.getRandom(this.adj));
		let adv = this.capitaliseFirstLetter(this.getRandom(this.adventure));
		let animal = this.capitaliseFirstLetter(this.getRandom(this.animal));
		let stuff = this.capitaliseFirstLetter(this.getRandom(this.stuff));
		let place = this.capitaliseFirstLetter(this.getRandom(this.place));
		let material = this.capitaliseFirstLetter(this.getRandom(this.material));

		if (Math.random() > .4)
			material = this.capitaliseFirstLetter(this.getRandom(this.colors));

		let fxns = [() => material + " " + place,() => place + " of " + adj + " " + stuff, () => adj + " " + place, () => "The " + material + " " + place, () => place + " of " + stuff]

		return this.getRandom(fxns)()

	},

	getRandomTitle: function() {
		let adv = this.capitaliseFirstLetter(this.getRandom(this.adventure));
		let animal = this.capitaliseFirstLetter(this.getRandom(this.animal));
		let stuff = this.capitaliseFirstLetter(this.getRandom(this.stuff));
		let place = this.capitaliseFirstLetter(this.getRandom(this.place));
		let material = this.capitaliseFirstLetter(this.getRandom(this.material));
		var adj = this.getRandom(this.mood);
		if (this.rng() > .5)
			adj = this.getRandom(this.color);
		if (this.rng() > .4)
			adv = place
		adj = this.capitaliseFirstLetter(adj)
		
		if (this.rng() < .3) {
			let prefix2 = "";
			if (this.rng() > .5)
					prefix2 += "The ";
			if (this.rng() > .5)
					prefix2 += this.capitaliseFirstLetter(this.getRandom(this.placeAdj)) + " "
			return prefix2 + `${this.capitaliseFirstLetter(material)} ${this.capitaliseFirstLetter(this.getRandom(this.object))}`
		}

		var thing = this.getRandom(this.place);
		if (this.rng() > .5)
			thing = this.getRandom(this.animal);
		if (this.rng() > .5)
			thing = this.getRandom(this.adventure);
		if (this.rng() > .4)
			thing = this.getRandom(this.object);
		thing = this.capitaliseFirstLetter(thing)
		

		let prefix = "";
		if (this.rng() > .4) {
			prefix = this.capitaliseFirstLetter(this.getRandom([this.getRandomWord(1) + "'s", this.getRandomWord(.5) + "'s", this.getRandomWord(.5) + "'s", "a", "every", "any", "that", "my", "our", "his", "her", "some", "the", "a", "last", "no"]));
			prefix += " "
		}

		


		let prefix2 = "";
		if (this.rng() > .4) {
			prefix2 = this.capitaliseFirstLetter(this.getRandom([this.getRandomWord(1) + "'s", this.getRandomWord(.5) + "'s", this.getRandomWord(.5) + "'s", "a", "every", "any", "that", "my", "our", "his", "her", "some", "the", "a", "last", "no"]));
			prefix2 += " "
		}

		let word = this.capitaliseFirstLetter(this.getRandomWord(.5));

		if (this.rng() > .94)
			return "The " + adj + " " + adv;
		if (this.rng() > .9)
			return prefix + adj + " " + place;

		if (this.rng() > .9) {
			return this.capitaliseFirstLetter(this.getRandom(this.preposition)) + " " + this.getRandom(this.article) + " " + adj + " " + thing;

		}
		if (this.rng() > .8) {
			return this.capitaliseFirstLetter(adj + " " + thing);
		}
		if (this.rng() > .8) {
			return this.capitaliseFirstLetter(this.getRandom(this.action) + " " + this.getRandom(this.article) + " " + adj + " " + thing);
		}

		if (this.rng() > .7)
			return prefix + adv + " " + this.getRandom(["of", "for", "under", "in", "beyond"]) + " " + prefix2 + stuff;
		if (this.rng() > .8)
			return animal + "'s " + adv;
		if (this.rng() > .7)
			return prefix + adv + " of " + stuff;
		if (this.rng() > .5)
			return word + "'s " + adv;
		if (this.rng() > .4)
			return prefix + word;
		return "The " + adv + " of the " + adj + " " + animal;
	},

	getRandomWord: function(lengthMult) {
		if (this.rng() > .5)
			return this.getRandom(this.syllables.first) + this.getRandom(this.syllables.last);

		if (!lengthMult)
			lengthMult = 1;
		var s = ""
		if (this.rng() > .3)
			s += this.getRandom(this.syllables.first);

		s += this.getRandom(this.syllables.middle);

		var count = Math.floor(this.rng() * this.rng() * lengthMult * 5);
		for (var i = 0; i < count; i++) {
			var mid = this.getRandom(this.syllables.middle);
			s += mid;

		}

		if (this.rng() > .3)
			s += this.getRandom(this.syllables.last);

		return s;
	},
	getRandomVerb: function() {

		var s = this.getRandom(this.syllables.first);

		var count = Math.floor(this.rng() * 3);
		for (var i = 0; i < count; i++) {
			var mid = this.getRandom(this.syllables.middle);
			s += mid;
		}
		s += this.getRandom(this.syllables.lastVerb);

		return s;
	},
	getRandomID: function(count = 8) {
		let s = ""
		for (var i = 0; i < count; i++) {
			if (this.rng() > .4)
				s += String.fromCharCode(this.rng() * 26 + 65);
			else
				s += String.fromCharCode(this.rng() * 10 + 48);
		}

		return s
	}
}


function bezier([p0, p1, p2, p3], t) {
	let t0 = 1 - t
	return [p0[0]*t0*t0*t0 + 3*p1[0]*t0*t0*t + 3*p2[0]*t0*t*t + p3[0]*t*t*t,
			p0[1]*t0*t0*t0 + 3*p1[1]*t0*t0*t + 3*p2[1]*t0*t*t + p3[1]*t*t*t]
}


function microtracery (gr, rule) {
	return rule.split("#").map((s,index) => {
		if (index%2==0) return s

		let r = gr[s]
		if (!r) return `((${s}))`

		r = Array.isArray(r)?r[Math.floor(r.length*Math.random())]:r

		return microtracery(gr, r)
	}).join("")
}

// eg. [2, doThing, x, y, 10, veryLikelyThing]
function weightedRandom(arr) {
    let count = 0
    let threshholds = []
    let items = []
    let lastWeight = 1
    // console.log(arr)
    for (var i = 0; i < arr.length; i++) {
    	// console.log(arr[i], typeof arr[i])
        if (typeof arr[i] !== 'number') {
            items.push(arr[i])
            count += lastWeight
            threshholds.push(count)
            lastWeight = 1
        } 
        else 
            lastWeight = arr[i]
    }

    // console.log(items, threshholds, count)

    let v = Math.random()*count
    // console.log(v)
    for (var i = 0; i < items.length; i++) {

        if (v < threshholds[i]) {
           return items[i]
        }
    }
    return arr[0]
}





let testGrammar = {
	greeting: ["nihao", "hi", "hello", "bonjour", "ciao"],
	animal: ["cat","okapi", "capybara", "emu", "narwhal", "coyote"],
	color: ["pink", "green", "aqua", "silver"],
	mood: ["happy", "elated", "morose", "sleepy", "enigmatic"],
	object: words.object,
	place: words.places,
	objAdj: words.objAdj,
	origin: [
	"#color.a.capitalize# #animal# was #color#, and said <b>#greeting.capitalize#</b>", 
	"[myObj:#object#][myColor:#color#]#myColor.a.capitalize# #myObj# was in #place.a#. It was #objAdj# for #myObj.a#"]
}

String.prototype.hashCode = function() {
	var hash = 0, i, chr;
	if (this.length === 0) return hash;
	for (i = 0; i < this.length; i++) {
		chr   = this.charCodeAt(i);
		hash  = ((hash << 5) - hash) + chr;
		hash |= 0; // Convert to 32bit integer
	}
	return hash;
};