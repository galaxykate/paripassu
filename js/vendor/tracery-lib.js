/**
 * @author Kate
 */

const eryContextMap = {
	"rule": {
		protected: {
			"[": "expression",
			"#": "expression",
		}
	},
	"expression": {
		protected: {
			"[": "expression",
			"(": "expression",
			"{": "expression",
		},
		splitters: [":", "->", " for ", " in ", " if ", ",", "?", ".", 
			"+=", "*=", "/=", "-=",  "^=", "%=", "||", "&&", 
			">=", "<=", "==", "!=", "<", ">", "=", 
			"++", "--",  "^", "%", "!", "+", "*", "/", "-"]
	}
}


function isVowel(c) {
	var c2 = c.toLowerCase();
	return (c2 === 'a') || (c2 === 'e') || (c2 === 'i') || (c2 === 'o') || (c2 === 'u');
};

function isAlphaNum(c) {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
};
function escapeRegExp(str) {
	return str.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
}

var baseEngModifiers = {

	replace : function(s, params) {
		//http://stackoverflow.com/questions/1144783/replacing-all-occurrences-of-a-string-in-javascript
		return s.replace(new RegExp(escapeRegExp(params[0]), 'g'), params[1]);
	},

	capitalizeAll : function(s) {
		var s2 = "";
		var capNext = true;
		for (var i = 0; i < s.length; i++) {

			if (!isAlphaNum(s.charAt(i))) {
				capNext = true;
				s2 += s.charAt(i);
			} else {
				if (!capNext) {
					s2 += s.charAt(i);
				} else {
					s2 += s.charAt(i).toUpperCase();
					capNext = false;
				}

			}
		}
		return s2;
	},

	capitalize : function(s) {
		return s.charAt(0).toUpperCase() + s.substring(1);
	},

	a : function(s) {
		if (s.length > 0) {
			if (s.charAt(0).toLowerCase() === 'u') {
				if (s.length > 2) {
					if (s.charAt(2).toLowerCase() === 'i')
						return "a " + s;
				}
			}

			if (isVowel(s.charAt(0))) {
				return "an " + s;
			}
		}

		return "a " + s;

	},

	firstS : function(s) {
		console.log(s);
		var s2 = s.split(" ");

		var finished = baseEngModifiers.s(s2[0]) + " " + s2.slice(1).join(" ");
		console.log(finished);
		return finished;
	},

	s : function(s) {
		switch (s.charAt(s.length -1)) {
		case 's':
			return s + "es";
			break;
		case 'h':
			return s + "es";
			break;
		case 'x':
			return s + "es";
			break;
		case 'y':
			if (!isVowel(s.charAt(s.length - 2)))
				return s.substring(0, s.length - 1) + "ies";
			else
				return s + "s";
			break;
		default:
			return s + "s";
		}
	},
	ed : function(s) {
		switch (s.charAt(s.length -1)) {
		case 's':
			return s + "ed";
			break;
		case 'e':
			return s + "d";
			break;
		case 'h':
			return s + "ed";
			break;
		case 'x':
			return s + "ed";
			break;
		case 'y':
			if (!isVowel(s.charAt(s.length - 2)))
				return s.substring(0, s.length - 1) + "ied";
			else
				return s + "d";
			break;
		default:
			return s + "ed";
		}
	}
};

let templateCount = 0
function createTemplate(type, sections) {
	return {
		id: templateCount++,
		type: type,
		errors: [],
		raw: rejoinSections(sections)
	}
}

//============================================================
// PARSE RULE
function parseRule(parsed) {
	
	parsed = typeof parsed == "string"? parse(eryContextMap, "rule", parsed):parsed
	let rule = createTemplate("rule", parsed)

	rule.sections = parsed.map(section =>{ 
		if (typeof section === "string")
			return section
		else {
			if (section.openChar == "#") {
				return parseSocket(section.children)
			} else if (section.openChar == "[") {
				return parseStackAction(section.children)
			} else {
				console.log("unknown section", section)
			}
			
		}
	})
	
	if (rule.sections.length === 1 && typeof rule.sections[0] === "string")
		rule.isPlaintext = true
	return rule
}	

//============================================================
// PARSE SOCKET
function parseSocket(parsed) {
	// console.log("\nPARSE SOCKET", rejoinSections(parsed))
	parsed = typeof parsed == "string"? parse(eryContextMap, "expression", parsed):parsed
	let target, mods
	[target,...mods] = gatherBySplitter(".", parsed)

	let socket = createTemplate("socket", parsed)
	socket.target = parseAddress(target)
	socket.mods = mods.map(parseFxn)
	return socket
}	

//============================================================
// PARSE STACKACTION
function parseStackAction(parsed) {
	// console.log("\nPARSE SOCKET", rejoinSections(parsed))
	parsed = typeof parsed == "string"? parse(eryContextMap, "expression", parsed):parsed
	let target, rg
	// console.log(parsed)
	[target,rg] = gatherBySplitter(":", parsed)

	let stackaction = createTemplate("stackaction", parsed)
	stackaction.target = parseAddress(target)
	stackaction.rg = parseRule(rg[0])
	return stackaction
}	


//============================================================
// PARSE PATHS AND ADDRESSES
function parseAddress(parsed) {
	parsed = typeof parsed == "string"? parse(eryContextMap, "expression", parsed):parsed
	return rejoinSections(parsed)
}

function parseFxn(parsed) {
	parsed = typeof parsed == "string"? parse(eryContextMap, "expression", parsed):parsed
	return rejoinSections(parsed)
}

const closeChars = {
	"[": "]",
	"{": "}",
	"(": ")",
	"#": "#",
}

function rejoinSections(sections) {
	return sections.map(s => {
		if (typeof s === "string")
			return s
		if (s.splitter !== undefined)
			return s.splitter
		return s.s.substring(s.start, s.end)
	}).join("")
}

function gatherBySplitter(splitter, sections) {
	if (splitter === undefined)
		throw("no splitter")
	if (sections === undefined)
		throw("no sections")
	
	let subsections = [[]]
	for (var i = 0; i < sections.length; i++) {
		let s = sections[i]
		if (s.splitter === splitter) {
			subsections.push([])
		}
		else
			subsections[subsections.length - 1].push(s)
	}

	return subsections
}

/* 
 * Given a context map and start context, break this into sections, protected and splitters
 */
function parse(contextMap, startContext, s) {
	if (typeof s !== "string")
		throw("Nonstring to parse")
	// console.log("\n",s)
	let stack = []
	isEscaped = false

	let root = {
		raw: s,
		context: contextMap[startContext],
		children: [],
	}

	let current = root
	let textStart = 0

	let currentText = ""


	function addText(index) {

		let s2 = currentText + s.substring(textStart, index)
		if (s2.length > 0)
			current.children.push(s2)
		currentText = ""
	}

	function openProtected(index, openChar) {
		// console.log("Open", openChar)
		let contextID = current.context.protected[openChar]
		let context = contextMap[contextID]
		if (!contextID || !context) {
			console.log("No context!!!", contextID, openChar)
		}

		let protected = {
			start: index,
			context: context,
			children: [],
			parent: current,
			openChar: openChar,
			closeChar: closeChars[openChar],
			s: s,
			
		}

		addText(index)
		textStart = index + 1 
		current.children.push(protected)

		current = protected
		// console.log("current")
	}

	function closeProtected(index, closeChar) {
		// Add any text inside the protected
		addText(index)
		
		// Set the end
		current.end = index + 1
		current.inner = s.substring(current.start + 1, current.end - 1)
		current.raw = s.substring(current.start, current.end)

		// Switch back to the parent
		current = current.parent

		textStart = index + 1
	}


	for (var i = 0; i < s.length; i++) {
		// escape charcter?
		let c = s[i]
		if (i < textStart) {
			// console.log(textStart)
			// console.log(`text start skip '${c}'`)

			continue;
		}

		if (isEscaped) {
			isEscaped = false
			currentText += s.substring(textStart, i - 1)
			textStart = i
			continue
		}


		if (c === "\\") {
			isEscaped = true
			continue;
			
		} 	

		// Close the current protected?
		if (c === current.closeChar) {
			closeProtected(i, c)
			continue;
		}

		// Open a new protected?
		if (current.context.protected && current.context.protected[c]) {
			openProtected(i, c)
			continue;
		}

		
		// Does this start with any of our splitters?
		if (current.context.splitters) {
			for (var j = 0; j < current.context.splitters.length; j++) {
				let spl = current.context.splitters[j]
				if (s.startsWith(spl, i)) {
					
					addText(i)
					current.children.push({
						"splitter": spl
						
					})
					
					textStart = i + spl.length

				}
				continue;
			}
		}
		
		
	}
	addText(i)

	return root.children
}(function(global, deps, factory, root) {
  if(typeof define==='function'&&define.amd)define(deps,factory);
  else if(typeof module==='object'&&module.exports)module.exports=factory.apply(root,deps.map(function(_){return require(_.split(':')[0])}));
  else root[global]=factory.apply(root,deps.map(function(_){_=_.split(':');return root[_[_.length-1]]}));
} (
'tracery', [], 
function() {

	
	let nodeCount = 0

	class TraceryNode {

		// Initialize with either a parent or a context 
		//   (...we can get the context from the parent if we have one)
		constructor(parent, template) {
			this.id = nodeCount++
			if (parent.constructor === TraceryContext) {
				this.depth = 0
				this.context = parent
			} else {
				this.depth = parent.depth + 1
				this.context = parent.context
				this.parent = parent
			}
			this.template = template
			this.finished = undefined
			this.ruleNode = undefined

			if (typeof template === "string" || typeof template === "number") {
				// Non-dynamic node!
				
				this.isStatic = true
			} else {
				if (this.template.type === undefined)
					console.warn("bad template", this.template)
				// Create the components that will store dynamic content (like which rule is selected)
				if (template.sections)
					this.sections = template.sections.map(s => new TraceryNode(this, s))
				if (template.mods)
					this.mods = template.mods.map(s => new TraceryNode(this, s))
				if (template.target)
					this.target = new TraceryNode(this, template.target)
			
				if (template.rg) 
					this.rg = new TraceryNode(this, template.rg)
				}	
	
				
			
		}

		spacer(extra = 0) {
			let t = ""
			for (var i = 0; i< this.depth + extra; i++) {
				t += "\t"
			}
			return t
		}

		expand() {
			// Boring old static data? Set the finished value and move on!
			if (this.isStatic) {
				this.finished = this.template
				return this
			}
			// console.log(`${this.spacer()}expand ${this.template.type}(${this.template.id}) '${this.template.raw}'`)

			// Do a thing to expanded sections
			
			
			
			// Stackactions and Sockets have targets
			
			switch(this.template.type) {
				// rules and paths have sections
				case "rule": 
					this.sections.forEach(s => s.expand())
					this.finished = this.sections.map(s => s.finished).join("")
					break
				case "socket": 
					if (!this.target) {
						console.log(this.template)
					}
					this.target.expand()
					// What's the target?  Is it a path or just a plaintext key?
					this.ruleset = this.context.getRuleset(this.target)

					// No rules??!!??
					if (!this.ruleset) {
						this.finished = `((${this.target.finished}))`
					} else {
						this.rule = this.context.selectRule(this.ruleset, this)
						let parsed = parseRule(this.rule)

						// Create and expand the new 
						this.ruleNode = new TraceryNode(this, parsed)
						this.ruleNode.expand()

						this.finished = this.ruleNode.finished


						// Do modifier things
						this.mods.forEach(s => s.expand())
						this.mods.forEach(modNode => {
							let modID = modNode.finished
							let fxn = this.context.mods[modID]
							this.finished = fxn(this.finished)
						})

					}
					

					break;
				case "stackaction": 
					this.target.expand()
					this.rg.expand()
					this.context.pushRules(this.target, this.rg)
				
					this.finished = ""
					break
				default: console.warn("todo", this.template.type)
			}

			
				
			return this;
		}
		
	}

	class TraceryContext {
		constructor({grammar,rng}) {
			this.mods = baseEngModifiers
			this.overlay = {}
			this.grammar = grammar
			this.rng = rng || Math.random
			// if (!this.grammar)
			// 	console.warn("NO GRAMMAR")
			// console.log("New tracery context!")
		}

		pushRules(targetNode, rgNode) {
			let key = targetNode.finished
			if (!this.overlay[key])
				this.overlay[key] = []
			this.overlay[key].unshift([rgNode.finished])

		} 

		getRuleset(targetNode) {
			let key = targetNode.finished || targetNode
			if (typeof key === "string") {

				// Get the overlay if it exists
				if (this.overlay[key] && this.overlay[key].length > 0) {
					
					return this.overlay[key][0]
				}

				// Deal with missing keys (or grammars!!)
				if (this.grammar === undefined || this.grammar[key] === undefined) {
					
					return undefined
				}

				return this.grammar[key]
			}
			if (Array.isArray(key)) {
				
			}
		}

		selectRule(ruleset, node) {
			if (typeof ruleset === "string")
				return ruleset
			if (Array.isArray(ruleset)) {
				if (ruleset.length > 0) {
					let index = Math.floor(this.rng()*ruleset.length)
					return ruleset[index]
				}

				return "((no rules))"
			} 

			console.warn("Unknown ruleset", ruleset)
		}

		flatten(rule) {
			let node = this.expand(rule)
			return node.finished
		}

		expand(rule){
			rule = typeof rule === "string"?parseRule(rule):rule
			
			let node = new TraceryNode(this, rule)
			node.expand()
			return node
		}
	}

  return {
  	TraceryContext: TraceryContext
  };

},this));