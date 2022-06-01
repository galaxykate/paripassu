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
		this.tempDisplayName = params.name || words.getUserName()
		this.setID(params.room || "test")
		
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
		
		this.authID = undefined

		setInterval(() => {
			this.sim()
		}, 50)

		this.createUserHead()

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

	createUserHead() {
		console.log("Create primary user's head")
		this.userHead = new LiveObject(this, {
			paritype: "head",
			uid: LOCAL_UID,
			label: this.tempDisplayName
		})
		// Set us to a random position to prevent collisions
		
		this.userHead.isTracked = true
	}

	//=================================
	// Events

	onAuth(authID, database) {
		this.authID = authID
		// We have authenticated! 
		// Add ourselves to the room on firebase
		console.log(`Authenticated as ${authID}`)

		try {
			this.eventRef = firebase.database().ref('rooms/' + this.roomID + "/events");
			this.objectRef = firebase.database().ref('rooms/' + this.roomID + "/objects");

			// Post all the objects immediately, and set their references
			console.log("Post all existing objects", this.objects)
			for (const [uid, obj] of Object.entries(this.objects)) {
				if (obj.isTracked) {
					console.log("Posting existing object", obj.toString())
				
					obj.setRef()
					obj.post()
				}
				
			}

			this.objectRef.on("child_added", (snapshot) => {
				let data = snapshot.val()
				if (data) {

					// console.log("new child!")
					// console.log(snapshot.key, data)
					let key = snapshot.key
					console.log("NEW LiveObject ADDED", key)
				
					if (this.objects[key]) {
						console.log("\tAdd to existing LiveObject", key, data)
						this.objects[key].handleUpdate(data)
					}
					else {
						console.log("\tCreate new " + data.paritype + " from firebase data", data)
						data.uid = key
						let obj = new LiveObject(this, data)
					}
				}
			})
		}
		catch(err) {
			console.warn("No FB ref yet!")
		}

	}

	get displayName() {
		return this.userHead.displayName
	}

	post(type, data) {
		// console.log("--posting disabled--")
		// Temp local id, use Firebase ID when connected
		// let uid = "L_" + uuidv4().slice(-3)
			
		// let ev = {
		// 	type: type,
		// 	from: this.authID,
		// 	date: Date.now(),
		// 	data: data
		// }

		// // Do we have an eventRef? Use that
		// if (this.eventRef) {

		// 	var newPostRef = this.eventRef.push();
		// 	let uid = newPostRef.key
		// 	newPostRef.set(ev)
		// } else {
		// 	// No eventRef? we're playing locally, no server
		// 	this.events[uid] = ev
		// }
	}

	// handleUpdate(data) {
		
	// 	// Which are we missing?
	// 	for (const [uid, objData] of Object.entries(data)) {
	// 		if (this.objects[uid] === undefined) {
	// 			console.log("Create new local object from server data", uid.slice(-4), objData.paritype)
	// 			let localObj = new LiveObject(this, objData)
	// 		}

	// 		// Copy over the data
	// 		else {
	// 			// console.warn("Send update to uid")
	// 			this.objects[uid].handleUpdate(objData)
	// 		}
	// 	}
	// }



	
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
					let index = fakeBodies.length
					// Create a fake head object
					let head = new LiveObject(this, {
						paritype: "head",
						uid: "FAKE_" + index,
						authID: "FAKE_" + index,
						displayName: words.getUserName(),
						height: 1.4 + Math.random()*.2,
						label: "fake" + index,
						color: new Vector(Math.random()*360, 100, 50),
						setForce({t, dt, frameCount}) {
							let idNumber = this.uid.hashCode()

							this.f.set(0,0,0)

							let move = Math.max(0,2*noise(t*.12 + idNumber - 1))
							this.f.addPolar(move,20*noise(t*.2 + idNumber))


							if (this.position.length() > 4) {
								this.f.addScaledVector(this.position, -.02)
							}
							
							// if (this.fakeIndex == 0)
							// 	console.log(this.f.toFixed(2))

							this.v.y = this.height
							this.position.y = this.height
							this.lookAlong(this.v)
							this.rotateX(Math.PI/2)
							this.rotateZ(.5*noise(t*.2 + idNumber))
							// this.rotateY(Math.PI)
							// this.rotation.set(noise(idNumber + t*.1), Math.atan2(-this.v.x, -this.v.z), 0)
						}
					})
					console.log("Create fakebody", head.uid)
					head.fakeIndex = index
					head.position.setToCylindrical(3, 4 + 10*Math.random(), 1)
					
					fakeBodies.push(head)
				

				}


				// Simulate all the current fakebodies
				fakeBodies.forEach((fb,index) => {
					fb.updateObject(this.time)
				})

				fakeBodies.forEach(fb => {
					fb.handleUpdate(fb.getUpdateData())
				})

			}
		}, 20)

		// this.onAuth("USER")
	}

	
}