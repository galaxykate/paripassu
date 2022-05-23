/*
 * A class that represent a room and everything that happens in it
 * Has 
 * - events (updated occaisionally)
 * - bodies (updated continuously) (both are UID->object maps)
 * - connections to Firebase or PeerJS
 * - a unique id identifying the room
 */

// Deal with Vue setting data
function vueSet(obj, key, val) {
	try {
		console.log("Vue set", obj, key, val)
		Vue.set(obj, key, val)
	} catch (err) {
		obj[key] = val
	}
}

function isVector(value) {

	return Array.isArray(value) 
		&& value.length === 3
		&& !isNaN(value[0])
		&& !isNaN(value[1])
		&& !isNaN(value[2])
}

function copyObject(data, settings) {
	if (typeof data === "object") {
		// make a vector
		if (data instanceof Vector && settings.toArray)
			return data.toArray()

		// are we making a copy of an array-vector?
		if (isVector(data) && settings.toVector) {
			// console.log("copy arrayvector into Vector")
			return new Vector(data)
		}

		// make an array
		if (Array.isArray(data)) 
			return data.map(x => copyObject(x, settings))
		 
		// copy object
		// console.log("Create a new object")
		let obj = {}
		for (const [key, value] of Object.entries(data)) {
			// console.log("copy key", key, value)
			obj[key] = copyObject(value, settings)
		}
		return obj
	}
	return data
}

function vueCopyKey(obj, data, key) {
	// Copy the data at this key
	let v0 = obj[key]
	let v1 = data[key]

	if (v0 === undefined) {
		vueSet(obj, key, copyObject(v1, {toVector:true}))
	} else {
		// console.log("Copy key", key, v0, v1)
		if (v0 instanceof Vector && Array.isArray(v1)) {
			v0.setTo(v1)
		} 

		// Ok, have to actually copy the value at this key
		else if (typeof v0 === "object" && typeof v1 === "object") {
			// console.log("Copy an object")
			vueCopy(v0, v1)
		} else {
			throw(`Unknown type to copy ${v0}, ${v1}`)
		}

		
	}
}


function vueCopy(obj, data) {
	
	if (Array.isArray(obj)) {
		// Remove extra length
		toRemove = data.length - obj.length
		if (toRemove > 0) 
			obj.splice(obj.length - toRemove, toRemove)
		
		// Copy over and add the rest
		for (var i = 0; i < Math.max(data.length, obj.length); i++) {
			vueCopyKey(obj, data, i)
		}
	} else if (typeof obj == "object") {
		for (const [key, value] of Object.entries(data)) {
			// copy over all the values
			vueCopyKey(obj, data, key)
		}
	} else {
		throw("Unknown types")
	}
}


class Room {
	constructor() {
		this.roomID = "test"
		// Both uid->Obj maps
		this.bodies = {}
		this.events = {}

		this.simulate()
	}
	//=================================
	// Handling changes

	onBodyUpdate(id, bodyData) {
		// Is this new?
		if (this.bodies[id] === undefined) {
			// console.log(JSON.stringify(bodyData, null, 2))
			// console.log("Body data", typeof bodyData.hands[0].pos)

			Vue.set(this.bodies, id, copyObject(bodyData, {toVector:true}))
			this.bodies[id].color = new Vector(100, 50, 50)
			// console.log(this.bodies[id])
		}

		// Do we have new body data?
		else {
			let body = this.bodies[id]

			// body.pos.setTo(bodyData.pos)
			// Copy over all the values
			// vueCopyKey(body, bodyData, "pos")
			// console.log("Copy over pos", body)

			vueCopy(this.bodies[id], bodyData)
			// console.log(this.bodies[id], bodyData)
		}	

		// for (const [key, value] of Object.entries(this.bodies)) {
		// 	console.log(key, value)
		// }
	}

	//=================================

	simulate() {


		let testBodies = []
		for (var i = 0; i < 1; i++) {
			testBodies.push(new TestBody())
		}

		let t = Date.now()*.001
		let count = 100
		setInterval(() => {
			if (count > 0) {
				let t2 = Date.now()*.001
				let dt = t2 - t
				testBodies.forEach(b => {
					b.update(t, dt)
					this.onBodyUpdate(b.id, b.toBodyData())
				})
				
				t = t2
				count--
			}
		}, 100) 

		
		// Make a bunch of fake events and body movements
	}

	connectToFirebase(realtimeDatabaseRef) {

	}

	connectToPeer(id) {
		// Connect to this peer
	}
}