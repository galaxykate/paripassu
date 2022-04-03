
let peerServerSettings = {
	host: 'peerjs.adamsmith.as',
	port: 9000,
	secure: true
}


class Room {

	constructor() {
		this.roomID = "pp_test"

		// Create the link to the peer, trying as host at first
		this.peerServer = new Peer(this.roomID, peerServerSettings)
		this.peerServer.on("open", (id) => {
			this._joinAsHost(id)
		}).on("error", (err) => {
			if (err.type == 'unavailable-id') {

				// Join as guest
				this.peerServer = new Peer(peerServerSettings)
				this.peerServer.on("open", (id) => {
					this._joinAsGuest(id)
					console.log(this.peerServer)
				})
			}
		})

		this.hostConnection = undefined
		this.guestConnections = []

		this.events = []
		this.handlers = {}

	}

	on(eventType, fxn) {
		if (this.handlers[eventType] === undefined)
			this.handlers[eventType] = []
		this.handlers[eventType].push(fxn)
		return this
	}


	move(moveObj) {
		this.postEvent("move", moveObj)
	}



	_addEvent(ev, isLocal) {
		if (!Array.isArray(ev)) {
			ev = [ev]
		}

		ev.forEach(e => {
			if (e.type !== "move") {
				console.log("Add event type", e.type)
				this.events.push(e)
			}
			else {

				this.handlers.move?.forEach(fxn => fxn(e.content))
			}
		})
	}

	postEvent(type, content) {
		let ev = {
			type: type,
			from: this.peerID,
			date: Date.now(),
			content: content
		}

		this._addEvent(ev, true)

		if (this.hostConnection)
			this.hostConnection.send([ev])

		if (this.guestConnections)
			this.guestConnections.forEach(conn => conn.send([ev]))
	}

	_joinAsGuest(id) {
		this.peerID = id
		// Make a connection to the host
		this.hostConnection = this.peerServer.connect(this.roomID, {metadata:"hello!", serialization: "json"})
		
		this.postEvent("join", {text:`joined as ${this.peerID.slice(-4)}`})

		this.hostConnection.on("open", () => {
			console.log("Opened host connection!")

			// Send all of my backlog events
			console.log("send event backlog", this.events)
			this.hostConnection.send(this.events)

			this.hostConnection.on("data", (data) => {
				// console.log("Data from host!", data)
				this._addEvent(data)

			})
		}) 
	}
	_joinAsHost(id) {
		this.peerID = id

		this.postEvent("host", {text:`started hosting ${id}`})

		// Deal with guest connections
		this.peerServer.on("connection", (conn) => {
			console.log("connection requested", conn)
			this.guestConnections.push(conn)

			

			conn.on("open", () => {
				// Send all of my backlog events to the new guest
				console.log(`Sending guest ${conn.peer.slice(-4)} a backlog of ${this.events.length} events`)
				conn.send(this.events)
			}).on("close", () => {
				console.log("Closed a connection")
				conn.closedOn = Date.now()
				this.postEvent("left", {text:`${conn.peer.slice(-4)} left`})
				

			}).on("data", (data) => {
				// console.log(`Data from ${conn.peer.slice(-4)}`, data)
				// Data from guest
				this._addEvent(data)


				// Send to all *other* guests
				this.guestConnections.forEach(g => {
					if (g != conn)
						g.send(data)
				})
			
			})
		})
	}

	get peerStatus() {
		return this.peerServer._open?"open":"pending"
	}

	get role() {
		if (this.isHost)
			return "host"
		if (this.isGuest)
			return "guest"

		return "---"
	}

	get isHost() {
		return this.peerID == this.roomID && this.peerServer._open
	}

	get isGuest() {
		return this.peerID != this.roomID && this.peerServer._open
	}

	join() {
		console.log("IO: connect to room")
	}

	connectFirebase() {
		console.warn("Can't connect to Firebase, TODO")
	}
}

