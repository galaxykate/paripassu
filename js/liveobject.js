/*
 * Data that is connected *live*
 * What happens when we get a position from online (like a new body part)?
 * Hopefully, we heard about that as part of an event? or part of a value change?
 */



Vue.component("live-object", {
	template: `<a-entity>
	
		<a-text 
			v-if="obj.label && !isUser"
			:value="obj.label"
			:width="obj.labelWidth || 1"
			:color="obj.labelColor||obj.labelColor||'black'"
			:position="obj.position.toAFrame(0,.2 + (obj.size.y||obj.size),0)"
			:rotation="obj.cameraFacing.rotation.toAFrame()"
			>
		</a-text>

		<component :is="'obj-' + (obj.paritype || 'cube')" 
			v-if="!isUser"
			:obj="obj" 
			:position="obj.position.toAFrame(0,0,0)" 
			:rotation="obj.rotation.toAFrame()" />

		<!-- Mirror test! -->
		<a-entity v-else scale="1 1 -1">
			<component :is="'obj-' + (obj.paritype || 'cube')" 
				v-if="mirrorself"
				:obj="obj" 
				:position="obj.position.toAFrame(0,0,mirrorself)" 
				:rotation="obj.rotation.toAFrame()" />
		</a-entity>
	</a-entity>`,
	computed: {
		isUser() {
			// console.log("Is user", this.obj.room.userHead === this.obj, this.objuid)
			return this.obj.room.userHead == this.obj
		}
	},
	data() {
		return {
			mirrorself: parseFloat(params.mirrorself || 0)
		}
	},
	props: ["obj"]
})

const trackedProperties = ["displayName", "color", "size", "uid", "authID", "label", "labelColor", "labelSize"]

class LiveObject extends THREE.Object3D {

 	constructor(room, data) {
 		super()
 		if (data == undefined) {
 			console.warn("No data for LiveObject!")
 		}

 		this.up.set(0, 1, 0)

 		// Default
 		this.uid = uuidv4()
 		this.color = new Vector(Math.random()*360, 100, 50)
 		this.size = .2
 		this.drag = .01
 		
 		
 		// Particle things
 		this.v = new THREE.Vector3()
 		this.v = new THREE.Vector3()
 		this.f = new THREE.Vector3()


 		// Updatable values
 		this.lastUpdate = {}
 		this.cameraFacing = new THREE.Object3D()

 		// console.warn(data, this)
 		this.lastPost = {}
 		this.lastPostTime = Date.now()


 		// Copy over all the data
 		// this needs to set the UID *before* we add this to the room
 		this.handleUpdate(data)

 		
 		// Give me a uid and add me to the room
 		if (!room) {
 			// console.warn(`No room provided for LiveObject of type ${data.type}`)
 		} else {
 			this.room = room
 			Vue.set(this.room.objects, this.uid, this)


 			this.room.post("createLO", {
 				uid: this.uid,
 				paritype: this.paritype
 			})

 			if (this.room.objectRef)
 				this.setRef()
 		}
 		



 		// console.warn("Created", this.paritype, this.uid)

 	}

 	screenPosition() {
 		/*
 		* Get the screen position of a 3D object
 		*/
		// var vector = new THREE.Vector3();
		// var projector = new THREE.Projector();
		// projector.projectVector( vector.setFromMatrixPosition( object.matrixWorld ), camera );

 	}

 	updateObject(time) {

 		if (this.setForce)
 			this.setForce(time)

 		// Do physics things
 		this.v.addScaledVector(this.f, time.dt) 
		
		
		this.position.addScaledVector(this.v, time.dt) 
		
		if (this.drag)
			this.v.multiplyScalar(1 - this.drag)

 		if (this.room)
 			this.setCameraFacing()

 		if (this.onUpdate)
 			this.onUpdate(time)


 	}

 	// Update the camera-facing angle to be towards the current camera
 	setCameraFacing() {
 		this.cameraFacing.position.copy(this.position)
 		if (this.room && this.room.userHead && this.label) {
 			// Look at the user's head if they have one
	 		// console.log(this.label, "Look at", room.userHead.position.toFixed(2))
	 		this.cameraFacing.lookAt(room.userHead.position)
	 		Vue.set(this.cameraFacing.rotation, "x", this.cameraFacing.rotation.x)
	 		// console.log(this.label, this.cameraFacing.rotation.toAFrame())
	 	} else {
	 		// console.log("no user head")
	 	}
 	}


 	handleUpdate(data) {
 		// if (this.paritype || data.paritype)
 		// 	console.warn(`${this} Handle data`, data)

		for (const [key, value] of Object.entries(data)) {
			// console.log(key, value)
 			let current = this[key]

			if (current instanceof THREE.Vector3 || current instanceof THREE.Euler) {
				
				current.set(...value)

 			}
 			else if (current instanceof Vector) {
 				current.setTo(value)
 			}
 			else
				this[key] = value
		}
 	}


	setRef() {
		this.ref = this.room.objectRef.child(this.uid)
		this.ref.on("value", (snapshot) => {
			// Subscribe to value changes
			if (snapshot.exists())
				this.handleUpdate( snapshot.val())
		})
	}

	getUpdateData(postAll=false) {
		let minRot = .01
		let minPos = .01
		
		let update = {}

 		for (const key of trackedKeys) {
 			let v = this[key]
 			if (v !== undefined) {
 				let changed = (this.lastPost[key] !== v)
 				// Vectors are fancy
	 			if (v instanceof Vector || v instanceof THREE.Vector3 || v instanceof THREE.Euler) {
	 				v = v.toArray()
	 			}
	 			
	 			if (Array.isArray(v)) {
	 				changed = getDistance(v, this.lastPost[key]) > .1
	 			}

	 			// Is this key on this object?
	 			// Has it changed? update!
	 			if (changed || postAll) {
	 				// console.log(key, "Changed")
	 				update[key] = v
	 			}
	 		}
	 	}
	 	return update

	}

 	post(postAll=false) {
 		let t = Date.now()
 		let minTime = params.rate?1000/params.rate:50

		this.timeSinceUpdate = t - this.lastPostTime
 		
 		let update = this.getUpdateData(postAll)

	 	// Decide whether to post this data
 		if (Object.keys(update).length > 0 && this.timeSinceUpdate > minTime) {
 			// console.log(`Update ${this}, Δt=${this.timeSinceUpdate.toFixed(3)}s, Δpos=${deltaPos.toFixed(3)}, Δrot=${deltaRot.toFixed(3)}`, Object.keys(update))
 			
 			// Make the Firebase post
 			if (this.ref) {
 				Object.assign(this.lastPost, update)
 				this.lastPostTime = t

 				console.log("post to FB", update)
 				this.ref.update(update)
 			}
 		} else {
 			// console.log(`Skip update for ${this}, Δt=${this.timeSinceUpdate.toFixed(3)}s, Δpos=${deltaPos.toFixed(3)}, Δrot=${deltaRot.toFixed(3)}`)
 		}

 		
 	}

 	// setUID(uid) {
 	// 	let oldUID = this.uid
 		
 	// 	Vue.delete(this.room.objects, oldUID)
 	// 	Vue.set(this.room.objects, uid, this)
 		
 	// 	this.uid = uid
 	// }

 	toString() {
 		return `${this.paritype}${this.uid.slice(-4)}`
 	}
 }



 function getDistance(a, b) {
 	if (a === undefined || b === undefined) {
 		return 999999
 	}
 	return Math.sqrt((a[0]-b[0])**2
 		 + (a[1]-b[1])**2
 		 + (a[2]-b[2])**2)
 }


