
/*
 Apps are made out of a header (title/controls) and footer
 and some number of columns
 If its vertical, the columns can become sections in one column
 */


/*
	When events happen in the widgets, post them to Io?
	Or should every widget have access to the event log?
	"Something happened here, please send this to everyone"
*/

// Get query parameters
const urlSearchParams = new URLSearchParams(window.location.search);
const params = Object.fromEntries(urlSearchParams.entries());

// Don't warn about "unknown" AFrame elements
Vue.config.ignoredElements = [/^a-/];

function controlUpdate(ev) {
	console.log(ev)
}

let room = new Room(params["room"] || "test")

window.onload = (event) => {

	// Create a room

	let particles = []
	for (var i = 0; i < 5; i++) {
		let p = new Vector(Math.random()*10 - 2, 0, Math.random()*12 - 4)
		p.radius = Math.random()*.4 + .1
		particles.push(p)
	}

	
	


	AFRAME.registerComponent('camera-watcher', {
		schema: {},  // System schema. Parses into `this.data`.

		init: function () {
			// Called on scene initialization.
			// console.log("INIT")
			// console.log(this.el.object3D)

		},

		tick: function () {
			// console.log(this.el.object3D)
			// `rotation` is a three.js Euler using radians. `quaternion` also available.
			// console.log(this.el.object3D.rotation);

			// `position` is a three.js Vector3.
			// console.log(this.el.object3D.position);
			var worldPos = new THREE.Vector3();
			var rotation = this.el.getAttribute('rotation');
   
   			// Track the camera's rotation
   			
   			// Set the current head position based on the camera's position
   			worldPos.setFromMatrixPosition(this.el.object3D.matrixWorld);
			room.user.setHeadPosition(worldPos, rotation)
		},

		// Other handlers and methods.
	});
	
	Vue.component("vr-user", {
		template: `
					<a-entity v-if="!user.isSelf">
						<a-box :color="user.getColor(-.3)" :position="user.footPosition" depth=".15" :height="user.height*1.6" width=".35"></a-box>
						<a-entity :position="user.headPosition" :rotation="user.headRotation">
							<a-box :color="user.getColor()" position="0 0 .05" :depth="user.headSize" :height="user.headSize" :width="user.headSize"></a-box>
							<a-box :color="user.getColor(-.2)" position="0 0 -.1" :depth="user.headSize*.5" :height="user.headSize*.3" :width="user.headSize*.2"></a-box>
						</a-entity>
						
					</a-entity>
				`,

		props: ["user"]
	})

	const app = new Vue({
		template: `
		<div id="app">
		<header></header>
			<a-scene v-if="urlParams.aframe">
				<a-entity :position="startingPos.toAFrame()">
					<a-entity id="camera"  camera camera-watcher look-controls></a-entity>
				</a-entity>
				
				<vr-user  v-for="user in room.users" :user="user"  />
				
				<a-box v-for="p in particles" :position="p.toAFrame()" color="#EF2D5E" :animation="boxAnimation">
				</a-box>
				
				<a-plane position="0 0 0" rotation="-90 0 0" width="40" height="40" color="#7BC8A4"></a-plane>
				<a-sky color="#ECECEC"></a-sky>
			</a-scene>

			<div id="main-columns" style="position:absolute">
				<div>
				USERS
				<table>
					<tr v-for="user in room.users" class="user-row" :class="{self:user.isSelf}">
						<td :style='{color:user.getColor(-.4, 1)}'>{{user}}</td>
						<td>Pos: ({{user.head.position.toFixed(2)}})</td>
						<td>Rot: ({{user.head.rotation.toFixed(2)}})</td>
						<td>color: ({{user.color.toHex()}})</td>
						<td>connection: ({{user.connected}})</td>
						
					</tr>
				</table>

				</div>
				<div class="main-column" style="width:400px">


				</div>
				
			</div>
		
		<footer></footer>
		</div>`,
		
		data() {
			return {
				startingPos: new Vector(Math.random(), 1.4, Math.random()),
				urlParams: params,
				room: room,
				particles:particles,
			}
		},

		computed: {
			boxAnimation() {
				// return "property: position; to: 1 8 -10; dur: 500; easing: easeInOutQuad; loop: true; dir:alternate"
			},
			cameraPos() {

				if (this.room.user.head) {
					console.log("HEAD", this.room.user.head)
					let pos = this.room.user.head.position.toAFrame()
					return pos
				}
			return "0 4 0"
			// room.user.head.rotation.toAFrame()
		}
		},
		methods: {
		
		},
		
		props: [],

		mounted() {
			setInterval(() => {
				let t = Date.now()
		
				this.particles.forEach((p,index) => {
					// p.v[0] += .1
					// Vue.set(p.v, 0, Math.random())
					// console.log(p.toFixed(2))
				})
			}, 100)
		},


		el: "#app"
	})

};

