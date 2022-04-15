const LOG_PREFIX = "pp_eventlog_"
const LOCAL_PREFIX = "pp_demo_"
const ALLOW_PEER = false
const FAKE_POSITION = true
const ALLOW_FIREBASE = false
let peerServerSettings = {
	host: 'peerjs.adamsmith.as',
	port: 9000,
	secure: true
}

function toUploadable(obj) {
	// Skip all _ properties
	let obj2 = {}
	for (const key in obj) {
		if (obj.hasOwnProperty(key)) {
			if (key[0] !== "_" && obj[key] !== undefined) {
				obj2[key] = obj[key]
			}
		}
	}
	return obj2
}

// https://stackoverflow.com/questions/9229645/remove-duplicate-values-from-js-array
function uniqBy(a, key) {
	var seen = {};
	return a.filter(function(item) {
		var k = key(item);
		return seen.hasOwnProperty(k) ? false : (seen[k] = true);
	})
}


class GeoLocation {
	// where we are and what's nearby
	constructor() {
		this.pos = [0,0]
		
		setInterval(() => {
			this.queryPosition()
		}, 1000)
		

	}

	queryPosition() {
		if (FAKE_POSITION) {

			let time = Date.now()
			let r = .0020*(Math.sin(time*.0001) + 1)
			let theta = 10*Math.sin(time*.00003)
			setTimeout(() => {
				this.setCurrentPosition({
					coords: {
						latitude: 42.057 + r*Math.cos(theta), 
						longitude: -87.68 + r*Math.sin(theta)
					}
				})
			}, 100 + Math.random()*300) 
		} else {
			navigator.geolocation.getCurrentPosition((data) => this.setCurrentPosition(data), (err) => console.warn(err))
		}
	}

	setCurrentPosition(pos) {
		Vue.set(this.pos, 1, pos.coords.latitude)
		Vue.set(this.pos, 0, pos.coords.longitude)
		// console.log("New pos", pos, this.pos)
		
	}
}

class EventLog {
	/*
	*	A log of events which is kept mirrored across multiple systems
	* 	via Firebase or peer (etc)
	*/ 

	constructor() {
		this.events = []
		this.handlers = {}
	}

	on(eventType, handler) {
		if (this.handlers[eventType] == undefined)
			this.handlers[eventType] = []
		this.handlers[eventType].push(handler)
	}

	_stamp(ev) {
		ev.from = io.user.uid
		ev.date = Date.now()
		ev.uid = uuidv4()
		return ev
	}

	// Publicly accessible
	post(ev) {
		this._stamp(ev)
		this._add([ev], "post")	

		

		// If *I* sent these, also post them to FB
		this.sendEventsToFirebase([ev])
	}

	deleteAllEvents(event) {
		let toAdd = {type:"clear"}
		this._stamp(toAdd)
		
		this.sendEventsToFirebase([toAdd], this.events.slice())
		this.events.splice(0, this.events.length)
		this._add([toAdd], "delete")
	}

	deleteEvent(event) {

		// If src is local
		// Announce the deletion of events
		// to Firebase, peer, localstorage
		console.log("delete", event.type)
		let index = this.events.findIndex(ev => ev.uid == event || ev.uid == event.uid)
		console.log(index)
		let ev = this.events[index]
		this.events.splice(index, 1)

		this.sendEventsToFirebase([], [ev])
	}


	_add(events, src) {

		console.log(`Adding ${events.length} events from ${src}`)
		// Add events to this log from some source
		events.forEach(ev => {
			if (!this.events.find(ev0 => ev0.uid == ev.uid)) {
				this.events.push(ev)
				// When a new event happens, react to it
				console.log("NEW EVENT", ev.type)
			}
			else 
				console.log("skip", ev.uid)

		})

		// Keep events ordered
		this.events.sort((a, b) => a.date - b.date)

		
	}

	_remove(removeEventsByUID) {
		console.log("Remove events", removeEventsByUID)
		removeEventsByUID.forEach(uid => {
			let index = this.events.findIndex(ev0 => ev0.uid === uid)
			if (index >= 0) {
				console.log("Remove", uid, "at", index)
				this.events.splice(index, 1)
			} else {
				console.log("couldn't find to remove", uid)
			
			}
		})
	}
	
	getBy({from,type}) {
		return []
	}


	sendEventsToFirebase(events, removeEvents=[]) {
		console.log("SEND EVENTS", events, removeEvents)
		if (!this.fbEventRef) {
			console.warn(`No FB event ref, can't sent ${events.length}`)
			return
		}

		console.log(`FB event ref exists, sending ${events.length}`)

		// Send these to firebase
		let updates = {}
		events.forEach(ev => {
			updates[ev.uid] = toUploadable(ev)
		})

		removeEvents.forEach(ev => {
			updates[ev.uid] = null
		})
		

		console.log(updates)
		this.fbEventRef.update(updates)
	}

	connectFirebase(ref) {
		console.log("Connect eventlog to firebase")

		// If we have a roomID and firebase, we can listen for events
		
		this.fbEventRef = ref

		// Send existing events to firebase
		this.sendEventsToFirebase(this.events)

		this.fbEventRef.on('value', (snapshot) => {
			if (snapshot.exists()) {
				const data = snapshot.val();
				console.log("GOT DATA", Date.now(), data)

				// Is anything removed?
				let removeEventsByUID = this.events.map(ev => ev.uid).filter(uid => data[uid] == undefined)
				let events = Object.values(data)
				console.log("remove", removeEventsByUID)
				this._add(events, "firebase")
				this._remove(removeEventsByUID, "firebase")
			}
		});


	}
}

class User {
	constructor({uid, displayName, isSelf, peerID, peerConnection}) {
		this.uid = uid
		this.displayName = displayName
		this.isSelf = isSelf
		
		// Are we connected to them on peer?
		this.peerID = peerID
		this.peerConnection = peerConnection
	}

	post(room, event) {
		// Create an event originating here
		event.from = this.uid

		room.eventLog.post(event)
	}

}

function setLocalStorage(key, value) {
	localStorage.setItem(LOCAL_PREFIX + key, JSON.stringify(value))
	return value
}


function getOrSetLocalStorage(key, defaultValue) {
	let val = localStorage.getItem(LOCAL_PREFIX + key)
	if (val === null) {
		val = defaultValue
		toStore = JSON.stringify(defaultValue)
		localStorage.setItem(LOCAL_PREFIX + key, toStore)
		console.log("SAVING NEW LOCAL VALUE", key, defaultValue)
	} else {
		console.log("Parse", val)
		val = JSON.parse(val)
	}
	return val
}



class Room {

	constructor() {
		// A Room has a set of users, an eventlog, and a state
		this.roomID = "room47fakewildcats"

		
		this.eventLog = new EventLog()
		
		this.state = {}

		this.handlers = {}

		
	}

	getDisplayName(uid) {
		let displayName = "not present"
		let user = this.getUser(uid)
		if (user)
			displayName = user.displayName || "anonymous"
		return displayName
	}

	getUser(uid) {
		return this.users.find(u => u.uid === uid)
	}

	getEventsFrom(uid, reverse) {
		return this.eventLog.events.filter(ev => ev.from == uid)
	}

	getUserStatus(uid) {
		let events = this.getEventsFrom(uid, true).reverse()
		let lastJoin = events.findIndex(ev => ev.type == "join")
		let lastLeave = events.findIndex(ev => ev.type == "leave")
		console.log("last leave", lastLeave, "last join", lastJoin)
		if (lastJoin < 0)
			return "never joined"
		if (lastLeave >= 0 && lastLeave < lastJoin)
			return "left"
		return "active"
	}

	get users() {
		let users = []
		let joinEvents = this.eventLog.events.filter(ev => ev.type == "join")
		joinEvents.forEach(ev => {
			let newUser = ev.content
			let existing = users.find(u => u.uid == newUser.uid)
			if (!existing)
				users.push(newUser)
		})
		console.log("USERS", users)
		return users
	}

	// Send a message to this room
	sendMessage(text, settings) {
		// Send a message as this user
		this._postEvent("message", {
			text: text,
		})
	}

	_postEvent(type, content) {
		this.eventLog.post({
			type:type,
			content: content
		})
	}
	
	move(moveObj) {
		// Make a move
		this._postEvent("move", moveObj)
	}


	join(user) {
		// Given this room id, attempt to coordinate joining it with everyone else
		this._postEvent("join", toUploadable(user))


		window.addEventListener("beforeunload",  (e) => {

			var confirmationMessage = "leave?";
			this._postEvent("leave", toUploadable(user))

			(e || window.event).returnValue = confirmationMessage; //Gecko + IE
			return confirmationMessage;                            //Webkit, Safari, Chrome
		});

	}

	connectFirebase(fb) {

		const ref = fb.database().ref().child("rooms").child(this.roomID).child("events")
		this.eventLog.connectFirebase(ref)
	}

	on(eventType, fxn) {
		if (this.handlers[eventType] === undefined)
			this.handlers[eventType] = []
		this.handlers[eventType].push(fxn)
		return this
	}

	

	get messages() {
		return this.eventLog.getBy({type:"message"})
	}

	get players() {
		let join = this.eventLog.getBy({type:"join"})
		let leave = this.eventLog.getBy({type:"leave"})
		// TODO: calculate who is still here
	}
}


let io = {

	startIO() {
		this.room.join(this.user)

	},

	post(ev) {
		this.user.post(this.room, ev)
	},

	user: new User({
		isSelf: true, 
		uid: setLocalStorage("uid", uuidv4()),
		// uid: getOrSetLocalStorage("uid", uuidv4()),
		displayName: words.getUserName()
	}),

	room: new Room(),
	location: new GeoLocation()
}


