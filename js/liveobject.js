/*
 * Data that is connected *live*
 * What happens when we get a position from online (like a new body part)?
 * Hopefully, we heard about that as part of an event? or part of a value change?
 */

Vue.component("live-object", {
	template: `<a-entity>
	
		<a-text 
			v-if="obj.label"
			:value="obj.label"
			:width="obj.labelWidth || 1"
			:color="obj.labelColor||obj.labelColor||'black'"
			:position="obj.position.toAFrame(0,.2 + (obj.size.y||obj.size),0)"
			:rotation="obj.cameraFacing.rotation.toAFrame()"
			>
		</a-text>

		<component :is="'obj-' + (obj.paritype || 'cube')" 
			:obj="obj" 
			:position="obj.position.toAFrame(0,0,0)" 
			:rotation="obj.rotation.toAFrame()" />
	</a-entity>`,
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
 		
 		
 		this.handleUpdate(data)

 		// Particle things
 		this.v = new THREE.Vector3()
 		this.v = new THREE.Vector3()
 		this.f = new THREE.Vector3()

 		
 		
 		// Give me a uid and add me to the room
 		if (!room) {
 			// console.warn(`No room provided for LiveObject of type ${data.type}`)
 		} else {
 			this.room = room
 			Vue.set(this.room.objects, this.uid, this)
 		}
 		

 		// Updatable values
 		this.lastUpdate = {}
 		this.cameraFacing = new THREE.Object3D()

 		// console.warn(data, this)
 		
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
 		if (room.userHead && this.label) {
 			// Look at the user's head if they have one
	 		// console.log(this.label, "Look at", room.userHead.position.toFixed(2))
	 		this.cameraFacing.lookAt(room.userHead.position)
	 		Vue.set(this.cameraFacing.rotation, "x", this.cameraFacing.rotation.x)
	 		// console.log(this.label, this.cameraFacing.rotation.toAFrame())
	 	} else {
	 		// console.log("no user head")
	 	}
 	}

 	connect(ref) {
 		ref.child(this.id).on("value", (snapshot) => {
 			// When this value changes
 			if (snapshot.exists()) {
 				snapshot.val()
 			}
 		})
 	}

 	handleUpdate(data) {
		for (const [key, value] of Object.entries(data)) {
			// console.log(key, value)
 				
			if (key === "position" || key === "rotation") {
				this[key].set(...value)
 			}
 			else
				this[key] = value
		}
 	}

 	toPost() {
 		// TODO: reduce post to only stuff that changed
		return {
			label: this.label,
			position: this.position.toArray(),
			rotation: this.rotation.toArray(),
			uid: this.uid,
			paritype: this.paritype
		}
	}

 	post() {
 	// 	let minRot = .01
		// let minPos = .01
		// let minTime = .1
 	// 	// Decide whether to post this data
 	// 	let deltaPos = getDistance(this.lastPosted.pos, this.pos)
 	// 	let deltaRot = getDistance(this.lastPosted.rot, this.rot)

 	// 	// Create the update, what should we add?
	 // 	let update = {}
	 	
	 // 	if (deltaPos > minPos) 
	 // 		update["pos"] = this.pos.toArray()
	 // 	if (deltaRot > minRot) 
	 // 		update["rot"] = this.rot.toArray()

 	// 	if (Object.keys(update).length > 0) {
 	// 		console.log(`Update ${this}, Δt=${this.timeSinceUpdate.toFixed(3)}s, Δpos=${deltaPos.toFixed(3)}, Δrot=${deltaRot.toFixed(3)}`)
 	// 		Object.assign(this.lastUpdate, update)
 	// 	} else {
 	// 		console.log(`Skip update for ${this}, Δt=${this.timeSinceUpdate.toFixed(3)}s, Δpos=${deltaPos.toFixed(3)}, Δrot=${deltaRot.toFixed(3)}`)
 	// 	}
 	}
 }


 function getDistance(a, b) {
 	return Math.sqrt((a.x-b.x)**2
 		 + (a.y-b.y)**2
 		 + (a.y-b.y)**2)
 }


