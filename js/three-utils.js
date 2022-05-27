// Mixins

THREE.Object3D.prototype.lookAlong = function(v) {
	this.lookAt(this.position.x + v.x, this.position.y + v.y, this.position.z + v.z)
}
THREE.Vector3.prototype.toFixed = function(n=2) {
	return `(${this.x.toFixed(n)},${this.y.toFixed(n)},${this.z.toFixed(n)})`
}
THREE.Vector3.prototype.toAFrame = function(x=0, y=0, z=0) {
	let n = 2
	let x2 = this.x + x
	let y2 = this.y + y
	let z2 = this.z + z
	return `${x2.toFixed(n)} ${y2.toFixed(n)} ${z2.toFixed(n)}`
}


//---------------------------------------------------------
// Polar, spherical, and cylindrical
THREE.Vector3.prototype.addPolar = function(r, theta, axis='y') {
	return this.setPolarMeta({r, theta, axis, increment:true})
}

THREE.Vector3.prototype.addCylindrical = function(r, theta, z, axis='y') {
	return this.setPolarMeta({r, theta, height:z, axis, increment:true})
}

THREE.Vector3.prototype.addSpherical = function(r, theta, phi, axis='y') {
	return this.setPolarMeta({r, theta, phi, axis, increment:true})
}

THREE.Vector3.prototype.setToPolar = function(r, theta, axis='y') {
	return this.setPolarMeta({r, theta, axis})
}

THREE.Vector3.prototype.setToCylindrical = function(r, theta, z, axis='y') {
	return this.setPolarMeta({r, theta, height:z, axis})
}

THREE.Vector3.prototype.setToSpherical = function(r, theta, phi, axis='y') {
	return this.setPolarMeta({r, theta, phi, axis})
}

THREE.Vector3.prototype.setPolarMeta = function({r, theta, phi, height=0, axis='y',increment=false}) {
	let x = r*Math.cos(theta)
	let y = r*Math.sin(theta)
	let z = height
	if (phi !== undefined) {
		z = r*Math.sin(phi)
		x *= Math.cos(phi)
		y *= Math.cos(phi)
	}

	// Swap values
	if (axis === 'y') 
		[y, z] = [z, y];
	if (axis === 'x') 
		[x, z] = [z, x];

	if (increment) {
		this.x += x
		this.y += y
		this.z += z
	} else {
		this.x = x
		this.y = y
		this.z = z
	}
	return this
}

//--------------------------------------------------

THREE.Vector3.prototype.setToScaledVectors = function() {
	this.multiplyScalar(0)
	for (var i = 0; i < arguments.length/2; i++) {
		let v = arguments[i*2]
		let s = arguments[i*2 + 1]
		this.addScaledVector(v, s)
	}
}

THREE.Euler.prototype.toFixed = function(n=2) {
	return `(${this.x.toFixed(n)},${this.y.toFixed(n)},${this.z.toFixed(n)})`
}

THREE.Euler.prototype.toAFrame = function(n=2) {
	// Deal with axis order by always changing back to the XYZ order
	let e2 = this.clone()
	// console.log(e2.toFixed())
	e2.reorder("YZX")
	// console.log(e2.toFixed())
	let x = e2.x*180/Math.PI
	let y = e2.y*180/Math.PI
	let z = e2.z*180/Math.PI
	
	return `${x.toFixed(n)} ${y.toFixed(n)} ${z.toFixed(n)}`
}




// Default LiveObject render mode
Vue.component("obj-cube", {
	template: `<a-entity>
		<a-box 
		shadow
		:width="width"
		:height="height"
		:depth="depth"
		:color="obj.color.toHex()" 
			
		>
		<obj-axes scale=".1 .1 .1" v-if="false" />
	</a-box>
	</a-entity>
	`,
	computed: {
		color() {
			return this.obj.color.toHex?this.obj.color.toHex():this.obj.color
		},
		width() {
			return this.obj.size instanceof Vector ? this.obj.size.x : this.obj.size
		},
		height() {
			return this.obj.size instanceof Vector ? this.obj.size.z : this.obj.size
		},
		depth() {
			return this.obj.size instanceof Vector ? this.obj.size.y : this.obj.size
		}
	},
	props: ["obj"]
})

Vue.component("obj-axes", {
	template: `<a-entity>
		<a-box 
			color="gray"
			width="1"
			height="1"
			depth="1">
		</a-box>
		<a-box 
			color="red"
			width="4"
			height=".5"
			depth=".5"
			position="2 0 0">
		</a-box>
		<a-box 
			color="green"
			width=".5"
			height="4"
			depth=".5"
			position="0 2 0">
		</a-box>
		<a-box 
			color="blue"
			width=".5"
			height=".5"
			depth="4"
			position="0 0 2">
		</a-box>
	</a-entity>
	`,
	
})
