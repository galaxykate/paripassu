/*
	Room
	A "place" with many users
*/

// basicColors = ["#ff66ff", "#6699ff", "#3399ff", "#33ccff", "#66ffcc", "#66ff66", "#ccff66", "#ffcc66", "#ff9966", "#ff6699", "#ff66cc"]
const basicColors = ["magenta", "cyan", "blue", "orange", "green", "salmon", "grey", "white", "lime", "pink", "purple", "tomato"]

class User {

	// Create a user
	constructor(room) {
		this.room = room
		this.ref = undefined
		this.id = undefined


		this.head = {
			position: new Vector(0,0,0),
			rotation: new Vector(0,0,0)
		}

		this.headSize = .2

		// Set some default values for this user
		this.idNumber = Math.floor(Math.random()*1000)
		this.color = new Vector(Math.random()*360, 100, 50)
		this.displayName = words.getUserName()

		let theta = Math.random()*10
		this.head.position.setToZPolar(1, theta)
		this.head.rotation.setTo(0, theta*180/Math.PI, 0)

		this.controllers = undefined
		
	}

	setHeadPosition(pos, rot) {
		
		// Issue: if this is an Euler, we want 
		this.head.position.setTo(pos.x, pos.y, pos.z)
		this.head.rotation.setTo(rot.x, rot.y, rot.z)
		this.pushToServer()
		
	}

	get headPosition() {
		return this.head.position.toAFrame()
	}

	get headRotation() {
		return this.head.rotation.toAFrame()
	}

	get footPosition() {
		let v = this.head.position.clone()
		v.v[1] = 0
		return v.toAFrame()
		return ""
	}

	get height() {
		return this.head.position.v[1]
	}

	getColor(shade, fade) {
		return this.color.toHex(shade, fade)
	}

	toString() {
		return `${this.displayName} (${this.id?this.id.substr(-4,4):"---"})`
	}


	connectRef(id, userData) {
		// Register us on the room's list o' users
		Vue.set(this.room.users, id, this)

		console.log(`Setting id for ${this.displayName} to ${id}`)
		this.id = id

		// If we have a reference, subscribe to changes to this object
		// *our* reference in the Realtime Database
		this.ref = this.room.userRef.child(this.id)

	
		// Get initial snapshot
		this.ref.get().then((snapshot) => {
			// Do I have any starting values?
			// Use them, but keep anything we don't have 
			//  on the server yet (for new features)
			if (snapshot.exists()) 
				this.fromData(snapshot.val())

			// Create a push to the server in case we have new stuff
			this.pushToServer()

			this.ref.on('value', (snapshot) => {
				if (snapshot.exists()) {
					// Tell me whenever this user's data changes
					// console.log(`${this} value changed!!`)
					this.fromData(snapshot.val())
				} else {
					// console.log(`${this} DESTROYED!!`)
					Vue.delete(this.room.users, this.id)
				}
			});

			if (this.isSelf) {
				// Keep track of the user's status
				// For handling:
				// - status: if people have disconnected
				
				this.ref.onDisconnect().update({
					connected: false,
					time: Date.now()
				})
			}
		})
	
		
		return this
	}

	get isSelf() {
		return this.room.user === this
	}

	get postableData() {
		return {
			connected: true,
			time: Date.now(),
			color: this.color.toArray(),
			displayName: this.displayName,
			head: {
				position:this.head.position.toArray(),
				rotation:this.head.rotation.toArray()
			}
		}
	}

	pushToServer() {
		if (this.ref) {
			console.log(`${this} push data to server`, Object.keys(this.postableData).join(","))
			// Push this user's position to the server (only if it's us)
			this.ref.set(this.postableData)
		}
	}

	fromData(data) {
		let staticKeys = ["displayName", "connected"]
		let vectorKeys = ["color"]
		staticKeys.forEach(key => {
			// console.log(key, "server val", data[key], "current val", this[key])
			if (data[key] !== undefined)
				Vue.set(this, key, data[key])
		})
		vectorKeys.forEach(key => {
			// console.log(`\t${this} ${key}:`, "server val", data[key], "current val", this[key])
			if (data[key] !== undefined)
				this[key].setTo(data[key])
		})

		let headKeys = ["position", "rotation"]
		headKeys.forEach(key => {
			// console.log(`\t${this} ${key}:`, "server val", data[key], "current val", this[key])
			if (data.head && data.head[key] !== undefined)
				this.head[key].setTo(data.head[key])
		})
	}

}

class Room {
	constructor(id) {
		this.authID = undefined
		
		this.id = id
		
		// Create our "self"
		this.user = new User(this, true)
		this.users = {}
		this.exists = false
		this.createdOn = undefined
		this.createdBy = undefined
		this.events = {}

		// // Create some fake users
		// for (var i = 0; i < 4; i++) {
		// 	let u = new User(this)
		// 	u.connectRef("FAKE_" + words.getRandomSeed(4))
		// }

	}

	//===========================================
	// Handle continuous motion
	// Keep this user (and all users in this room)
	

	//===========================================
	// Constructing sublists
	
	
	// Treat "messages" like any property "console.log(room.messages)"
	// Access but not set, computed on the fly
	get messages() {
		return this.getEventsByType("chat")
	}

	

	get currentScores() {
		// Sum up all point events
		let events = this.getEventsByType("point")
		
		let scores = {
		
		}

		events.forEach(ev => {
			let userID = ev.data.to
			let count = ev.data.count
			
			// If not in our table yet, set to 0
			if (scores[userID] == undefined)
				scores[userID] = 0

			scores[userID] += count
		})


		return scores
	}
	
	getEventsByType(type) {
		return Object.entries(this.events)
			.map(ev => {
				ev[1].id = ev[0]
				return ev[1]
			})
			.filter(ev => ev.type == type)
	}
	
	
	//===========================================
	// Events
	
	postEvent(event) {
		event.from = this.user.id
		event.time = Date.now()
		console.log(`${this} posts an event:`, event)
	
		// this.ref is the ROOM's reference
		// Create a new entry in this list
		
		// let newEventRef = this.eventRef.push();
		// newEventRef.set(event);
		// console.log("Set successfully?")
	}



	//===========================================
	// Setup

	setFirebaseAuthUser(uid, userData) {
		// Logged in. with this authid	
		this.authID = uid
		console.log("Joined with ID", uid)

		// No connecting to a room until with have an authID
		this.connectToRoomID(this.id)
	}

	// What room is this?
	connectToRoomID(id) {
		if (this.authID === undefined) {
			console.warn("Can't connect to a room until authenticated!")
			return
		}

		console.log(`Connecting to room '${id}'`)
		this.id = id

		// Set up all the reference
		this.ref = this.database.ref(`rooms/${this.id}`)
		this.userRef = this.database.ref(`rooms/${this.id}/userStatus`)
		this.eventRef = this.database.ref(`rooms/${this.id}/events`)

		// Is the current user in here?

		this.users = {}
		this.events = []

		// Does this room already exist?
		this.ref.get().then((snapshot) => {

			console.log(`${this}: checking to see if this room exists`)
			if (snapshot.exists()) {
				console.log(`${this}: exists!`)		
				// This room exists!
				this.initializeFromServer(snapshot.val())
			} else {
				// This room does not exist, but we create it!
				console.log(`${this}: does not exist yet!`)		
				console.log(`${this}: Create this room on Firebase`)	
				this.ref.set({
					created: Date.now(),
					// Record our UID
					createdBy: this.authID, 
					id: this.id,
				})

			}

			// If we don't have a user for this authid, create one
			// Note: we may have already loaded one from Firebase if it existed
			if (this.users[this.authID] === undefined) {
				this.user.connectRef(this.authID)
			}
		})

		// Subscribe to new users
		this.userRef.on("value", (snapshot) => {
			for (const [id, ev] of Object.entries(snapshot.val())) {
				this.handleNewUser(ev, id)
			}
		})

	}



	initializeFromServer(data) {
		console.log(`-----\ninitialize room ${this} from server data`, data)

		for (const [key, val] of Object.entries(data)) {

			if (key === "events") {
				for (const [id, ev] of Object.entries(val)) {
					this.handleNewEvent(ev, id)
				}
			}
			else if (key === "userStatus") {
				for (const [id, ev] of Object.entries(val)) {
					this.handleNewUser(ev, id)
				}
			} else {
				console.log("copy basic data", key, val)
				Vue.set(this, key, val)
			}
		}
		console.log("-----")
		

	}

	handleNewUser(userData, id) {
		// A user has changed status?

		// Do we have this user?
		if (this.users[id] == undefined) {
			// Is it us (use our existing user) or someone else?
			let user = this.authID === id?this.user:new User(this)
			
			user.connectRef(id, userData)
		} 
	}


	
	handleNewEvent(ev, id) {
		if (this.events[id] === undefined) {
			// Add to my list of events
			ev.id = id
			Vue.set(this.events, id, ev)
		}
	}

	initFirebaseConnection(database) {
		console.log(`${this}: Initialized firebase connection`)
		this.database = database


	}

	toString() {
		return `Room '${this.id}'`
	}
}