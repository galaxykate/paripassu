/*
	Room
	A "place" with many users
*/


class User {
	constructor(isSelf, uid) {
		this.uid = uid
		this.isSelf = isSelf
		this.displayName = "okapi"
	}
}


class Room {
	constructor(id) {
		console.log("Created room:", id)
		this.id = id
		this.user = new User(true)
		this.users = {}
		this.exists = false
		this.createdOn = undefined
		this.createdBy = undefined
		this.events = []
	}

	//===========================================
	// Constructing sublists
	
	get messages() {
		return Object.entries(this.events)
			.map(ev => {
				ev[1].id = ev[0]
				return ev[1]
			})
			.filter(ev => ev.type == "chat")
	}
	
	
	//===========================================
	// Events
	
	postEvent(event) {
		event.from = this.user.uid
		event.time = Date.now()
		console.log(`${this} posts an event:`, event)
	
		// this.ref is the ROOM's reference
		// Create a new entry in this list
		let eventListRef = this.ref.child('events');
		let eventRef = eventListRef.push();
		eventRef.set(event);
	}

	//===========================================
	// Setup

	setFirebaseAuthUser(uid, userData) {
		console.log(uid)
		// console.log(userData)
		this.user.uid = uid


		console.log(`${this}: checking to see if this room exists`)
		this.connectToRoom()
	}

	connectToRoom() {
		// Once we are authenticated, connect to the room on FB

		// Get the INITIAL value, once!
		this.ref.get().then((snapshot) => {

			if (snapshot.exists()) {
				// This room exists!
				const data = snapshot.val();
				// Copy over all the room data (TODO, do better)
				this.handleNewData(data)
			} else {
				// This room does not exist, but we create it!
				console.log(`${this}: does not exist yet!`)		
				console.log(`${this}: Create this room on FB`)	
				this.ref.set({
					created: Date.now(),
					// Record our UID
					createdBy: this.user.uid, 
					id: this.id,
					log: []
				})

			}
		})

		this.ref.child("userStatus/" + this.user.uid).set({
			connected: true,
			time: Date.now()
		})
		this.ref.child("userStatus/" + this.user.uid).onDisconnect().set({
			connected: false,
			time: Date.now()
		})

		// Pubsub! Subscribe to changes in the value
		this.ref.on('value', (snapshot) => {
			// Tell me whenever this room changes
			const data = snapshot.val();
			this.handleNewData(data)
		});

		// Post a "I'm here" event
		this.postEvent({
			type: "join",
			data: {
				displayName: this.user.displayName,
				uid: this.user.uid
			}
		})
	}

	handleNewData(data) {
		function missingKeys(newObj, oldObj) {
			return Object.keys(newObj).filter(key => oldObj[key] === undefined)
		}

		// console.log("Handle new data", data)
		// console.log(`${Object.values(data.events).length} events`)
		// console.log(`${Object.values(data.userStatus).length} users`)
	
		// Deal with user updates
		let newUsers = missingKeys(data.userStatus, this.users)
		console.log("New users", newUsers)
		
		newUsers.forEach(id => {
			Vue.set(this.users, id, {
				id: id,
				displayName: "anon",
				status: data.userStatus[id]
			})
		})
		console.log("USERS", this.users)

		// Deal with events
		let newEvents = missingKeys(data.events, this.events)
		console.log("New events", newEvents)
		
		// Add and handle this event
		newEvents.forEach(id => this.handleEvent(data.events[id], id))
	}

	handleEvent(ev, id) {
		ev.id = id
		// Need to use Vue to subscribe to changes
		Vue.set(this.events, id, ev)
		// this.events[id] = ev
		
	}

	initFirebaseConnection(database) {
		console.log(`${this}: Initialized firebase connection`)

		// Does this room already exist?
		this.ref = database.ref('rooms/' + this.id)


	}

	toString() {
		return `Room '${this.id}'`
	}
}