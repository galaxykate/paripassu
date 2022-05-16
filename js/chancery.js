
function PathException(message, path, index) {
  this.message = message;
  this.path = path;
  this.index = index;
}

function vueSet(obj, key, val) {
	try {
		Vue.set(obj, key, val)
	}
	catch(err) {
		obj[key] = val
	}
	return val
}

function canHoldKey(obj, key) {
	if (Array.isArray(obj))
		return Number.isInteger(key)
	if (typeof obj === "object")
		return typeof key === "string"
	return false
}

function setAtPath(root, path, val) {
	console.log("Set at path", path, val)
	
	let lastKey = path[path.length - 1]
	let n = getAtPath(root, path.slice(0, -1), true, lastKey)
	// console.log(n)
	if (canHoldKey(n, lastKey)) {
		console.log("set", path, n, lastKey)
		val0 = n[lastKey]
		if (typeof val0 !== undefined && typeof val0 !== typeof val1) {
			console.warn("Trying to change type")
			return
		}
		vueSet(n, lastKey, val)
	}
	else
		console.warn(`Failed to set ${path} to ${val}: ${typeof n} can't hold key ${lastKey} of type ${typeof lastKey}`)
}

function getAtPath(root, path, createPaths, lastKey) {
	let n = root
	// console.log(n, path)
	for (var i = 0; i < path.length; i++) {
		let key = path[i]


		// console.log(typeof key)
		if (n !== undefined && !canHoldKey(n,key)) {
			throw(new PathException(`Incorrect key type '${key}' (${typeof key})  in path ${path.join('->')}`, path, i))
		}

		
		previous = n
		// What is *currently* at the next step?
		// Options: we *have* something at the next step
		n = n[key]
		console.log(previous, "->", key, n)
		
		if (previous[key] === undefined) {
			if (!createPaths) {
				// Missing a step, but can't create it? Error!
				throw(new PathException(`Missing next step at '${key}' (${typeof key}) in path ${path.join('->')}, but not allowed to create paths`, path, i))
			}
			if (!canHoldKey(previous, key)) {
				throw(new PathException(`Missing next step at '${key}' (${typeof key}) in path ${path.join('->')}, and ${typeof previous} can't hold a key of type ${typeof key}`, path, i))
			
			}

			// Ok, there's nothing here
		
			// We are looking at this index in this 
			// Do we currently have a container for this key?
			let nextKey = path[i + 1]
			if (lastKey !== undefined && i == path.length - 1)
				nextKey = lastKey
			
			console.log(`\ttry to create a container for next key: ${nextKey} at key '${key}' in`, previous)
			if (nextKey !== undefined) {
				// If we have a nextKey, 
				// we may want to create this current location as a container
				// which kind of container? Depends on the next key
				
				if (typeof nextKey === 'string') {
					console.log(`\tcreate dict at ${key} to hold ${nextKey}`)
					vueSet(previous, key, {})
				}
				else if (Number.isInteger(nextKey)) {
					console.log(`\tcreate array at ${key} to hold ${nextKey}`)
					vueSet(previous, key, [])
				}
				else {
					throw(new PathException(`Unknown key type ${key} in path ${path.join('->')}`, path, i))
				}

				n = previous[key]
				console.log("\twith new path: ", previous, "->", key, n)
				
				
			}

		}

		if (n === undefined)
			throw(new PathException(`Ended at undefined value!?`))
		
		


		

	}
	return n
}