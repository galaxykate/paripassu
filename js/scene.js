Vue.component("vr-body", {
	template: `
	<a-entity >
		<!--  BASE -->
		<a-entity v-if="body.pos" :position="body.pos.toAFrame()" :rotation="body.rot.toAFrame()">
			<a-cylinder radius="0.3" height=".2" :color="body.color.toHex()" shadow></a-cylinder>
			<a-cylinder radius="0.1" height=".2" position="0 0 .3" :color="body.color.toHex()" shadow></a-cylinder>
		</a-entity>
		
		<!--  HEAD AND TORSO -->
		<a-cylinder v-if="body.pos" :position="body.pos.toAFrame(0, 1, 0)" radius="0.2" height=".5" :color="body.color.toHex()" shadow></a-cylinder>
		<a-sphere v-if="body.head.pos" :position="body.head.pos.toAFrame()" radius=".2" :color="body.color.toHex()" shadow></a-sphere>
		
		<!--  HANDS -->
		<a-entity v-if="body.hands">
			<a-entity v-for="hand in body.hands" :position="hand.pos.toAFrame(0, 0, 0)">
				<a-sphere radius=".1"></a-sphere>
			</a-entity>
		</a-entity>
	</a-entity>`,
	props: ["body"]
})

Vue.component("room-scene", {
	template: `<a-scene>

		<a-entity position="0 0 -4">
			<a-plane position="0 0 0" rotation="-90 0 0" width="4" height="4" color="#7BC8A4" shadow></a-plane>
			<vr-body v-for="body in room.bodies" :body="body" />
			
		</a-entity>
	</a-scene>`,

	mounted() {
		console.log("BODIES", this.room.bodies)
	},

	props: ["room"],
})