/*
 * A class that represent a room and everything that happens in it
 * Has 
 * - events (updated occaisionally)
 * - bodies (updated continuously) (both are UID->object maps)
 * - connections to Firebase or PeerJS
 * - a unique id identifying the room
 */


class Room {
	constructor() {
		
		this.setID("test")
		
		// Update loop runs regardless of roomID
		// Initialize an update loop
		// 20fps
		let t = Date.now()*.001
		this.time = {
			start: t,
			lastSim: t,
			frameCount: 0,
			t:  t,
			dt: .01,
			onSecondChange(fxn) {
				this.onSecondChangeHandlers.push(fxn)
			},
			onSecondChangeHandlers: [],
		}
		
		setInterval(() => {
			this.sim()
		}, 50)

		this.fakeData()
	}

	

	// Start a new room with this ID
	setID(roomID) {
		// Seed the noise 
		this.roomID = roomID
		this.idNumber = roomID.hashCode()

		this.titleText = "Room: " + this.roomID
		this.detailText = "some text here"

		noise.seed(this.idNumber)
		// Both uid->Obj maps
		this.objects = {}
		this.events = {}

		initializeRoom(this)

	}

	sim() {
		
		// Time updates
		this.time.t =  Date.now()*.001
		this.time.dt = this.time.lastSim - this.time.t
		
		this.time.lastSim = this.time.t
		this.time.frameCount += 1

		// Set up a timed event
		let second = Math.floor(this.time.t)
	
		if (second !== this.time.second) {
			// The second has changed!
			this.time.second = second
			this.time.onSecondChangeHandlers.forEach(fxn => fxn(this.time.second))
		}



		for (const [uid, obj] of Object.entries(this.objects)) {
			// console.log(obj)
			obj.updateObject(this.time)

		}
	}


	//=================================
	// Events

	onAuth(authID) {
		this.userHead = new LiveObject(this, {
			type: "head",
			authID: authID,
			displayName: words.getUserName()
		})

	}

	post(event) {

	}

	handleUpdate(data) {
		
		// Which are we missing?
		for (const [uid, objData] of Object.entries(data)) {
			if (this.objects[uid] === undefined) {
				console.log("Create new local object from server data", uid.slice(-4), objData.paritype)
				let localObj = new LiveObject(this, objData)
			}

			// Copy over the data
			this.objects[uid].handleUpdate(objData)
		}
	}



	
	//=================================
	// Fakedata

	fakeData() {

		
		// Fake people moving and generating data

		// let grammar = new tracery.createGrammar(  {
		// 	origin : "[myPlace:#path#]#line#",
		// 	line : ["#mood.capitalize# and #mood#, the #myPlace# was #mood# with #substance#", "#nearby.capitalize# #myPlace.a# #move.ed# through the #path#, filling me with #substance#"],

		// 	nearby : ["beyond the #path#", "far away", "ahead", "behind me"],
		// 	substance : ["light", "reflections", "mist", "shadow", "darkness", "brightness", "gaiety", "merriment"],
		// 	mood : ["overcast", "alight", "clear", "darkened", "blue", "shadowed", "illuminated", "silver", "cool", "warm", "summer-warmed"],
		// 	path : ["stream", "brook", "path", "ravine", "forest", "fence", "stone wall"],
		// 	move : ["spiral", "twirl", "curl", "dance", "twine", "weave", "meander", "wander", "flow"],
		// }, {})
		// grammar.addModifiers(baseEngModifiers)

		let fakeBodies = []

		let count = 0

		setInterval(() => {
			count++
			if (count < fakeBodySteps) {

				if (fakeBodies.length < fakeBodyCount && Math.random() < .1) {
					
					console.log("New fake user")
					// Create a fake head object
					let head = new LiveObject(undefined, {
						paritype: "head",
						authID: "FAKE_" + uuidv4(),
						displayName: words.getUserName(),
						height: 1.6 + Math.random()*.2,
						label: "fake",
						color: new Vector(Math.random()*360, 100, 50),
						setForce({t, dt, frameCount}) {
							let idNumber = this.uid.hashCode()
							this.f.set(0,0,0)

							let move = Math.max(0,2*noise(t*.12 + idNumber - 1))
							this.f.addPolar(move,20*noise(t*.2 + idNumber))


							if (this.position.length() > 4) {
								this.f.addScaledVector(this.position, -.02)
							}
							this.position.z = this.height
						}
					})
					head.position.setToCylindrical(3, 4 + Math.random(), 1)
					fakeBodies.push(head)
				

				}


				// Simulate all the current fakebodies
				fakeBodies.forEach((fb,index) => {
					fb.updateObject(this.time)

				})

				let update = {}
				fakeBodies.forEach(fb => {
					update[fb.uid] = fb.toPost()
				})

				this.handleUpdate(update)
			}
		}, 20)

		this.onAuth("FAKE_USER_AUTHID")
	}

	//=================================

	
	connectToFirebase(realtimeDatabaseRef) {

	}

	connectToPeer(id) {
		// Connect to this peer
	}
}