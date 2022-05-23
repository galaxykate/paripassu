AFRAME.registerComponent('change-color-on-hover', {
	schema: {
	  color: {default: 'red'}
	},

	init: function () {
		let data = this.data;
		let el = this.el;  // The element we are looking at
		
		let previousColor = el.getAttribute('material').color;
		el.addEventListener('mouseenter', function () {
			previousColor = el.getAttribute('material').color;
			el.setAttribute('color', data.color);
		});

		el.addEventListener('mouseleave', function () {
			el.setAttribute('color', previousColor);
		});

		el.addEventListener('click', function () {
			previousColor = "black"
			el.setAttribute('color', previousColor);
		});
	}
});



Vue.component("room-scene", {
	template: `<a-scene>
		<!--------- ASSETS ---------->
		<a-assets>
			<img id="sky" src="img/textures/sky-night.png">
		</a-assets>

		<!--------- CAMERA --------->
		<a-camera>
			<a-cursor></a-cursor>
			
		</a-camera>
		
		<!--------- SKYBOX --------->
		<a-sky src="#sky"></a-sky>

		<a-entity position="0 0 -4">


			<a-plane position="0 0 0" rotation="-90 0 0" width="40" height="40" color="#7BC8A4" shadow></a-plane>
			

			<vr-body v-for="body in room.bodies" :body="body" />
			
			<a-entity text="font: mozillavr; value: Via stock font name."></a-entity>

			<!--------- SOME SCENERY --------->
			<a-entity>
				<a-box v-for="b in boxes" :position="b.pos.toAFrame()" 
					:rotation="b.rot.toAFrame()" 
					depth="2" height="4" width="0.5"
					change-color-on-hover="color: blue"
			
					>
				</a-box>
			</a-entity>

			<cheeseplate :room="room" />
		</a-entity>


	</a-scene>`,

	mounted() {
		console.log("BODIES", this.room.bodies)
		let count = 10

		for (var i = 0; i < count; i++) {
			let r = 5
			let theta = Math.PI*2*i/count

			this.boxes.push({
				pos: Vector.polar(r, theta, "y"),
				rot: new Vector(0, -theta*180/Math.PI, 0),
				size: Math.random()*1
			})


		}
		console.log(this.boxes)
	},

	data() {
		return  {
			boxes: []
		}
	},

	props: ["room"],
})