/*
	Room
	A "place" with many users
*/

basicColors = ["#ff66ff", "#6699ff", "#3399ff", "#33ccff", "#66ffcc", "#66ff66", "#ccff66", "#ffcc66", "#ff9966", "#ff6699", "#ff66cc"]

class Room {
	constructor(id) {
		this.authID = undefined
		console.log("Created room:", id)
		this.id = id
		
		this.user = {
			displayName: words.getUserName(),
			color: getRandom(basicColors)

		}
		this.exists = false
		this.createdOn = undefined
		this.createdBy = undefined
		this.events = []
	}

	//===========================================
	// Constructing sublists
	
	users() {
		let users = {

		}
		return users

	}
	

	get messages() {
		return this.getEventsByType("chat")
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
		let eventListRef = this.ref.child('events');
		let eventRef = eventListRef.push();
		eventRef.set(event);
		console.log("Set successfully?")
	}



	//===========================================
	// Setup

	setFirebaseAuthUser(uid, userData) {
		// Logged in. with this authid
		
		this.user.id = uid
		

		console.log("Joined with ID", uid)

		console.log(`${this}: checking to see if this room exists`)
		this.connectToRoom()
	}

	connectToRoom() {
		// Once we are authenticated, connect to the room on FB

		// Get the INITIAL value, once!
		this.ref.get().then((snapshot) => {

			if (snapshot.exists()) {
				console.log(`${this}: exists!`)		
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
					
				})

			}
		})

		// this.ref.child("userStatus/" + this.user.uid).set({
		// 	connected: true,
		// 	time: Date.now()
		// })
		// this.ref.child("userStatus/" + this.user.uid).onDisconnect().set({
		// 	connected: false,
		// 	time: Date.now()
		// })

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
				color: this.user.color,
				uid: this.user.id
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
		if (data.userStatus) {
			let newUsers = missingKeys(data.userStatus, this.users)
			
			newUsers.forEach(id => {
				// Add this user to the user registry
				// let newRecord = {
				// 	id: id,
				// 	displayName: "anon",
				// 	color: getRandom(basicColors),
				// 	status: data.userStatus[id]
				// }

				// if (id === this.authID) {
				// 	console.log("Found user!")
				// 	newRecord = this.user
				// } 
				// console.log("NEW", newRecord)

				// Vue.set(this.users, id, newRecord)

			})
		}
		if (data.events) {
			// Deal with events
			let newEvents = missingKeys(data.events, this.events)
			// console.log("New events", newEvents)
			
			// Add and handle this event
			newEvents.forEach(id => this.handleEvent(data.events[id], id))
		}
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