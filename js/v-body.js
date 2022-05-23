
Vue.component("vr-body", {
	template: `
	<a-entity>
		<!--  BASE -->
		<a-entity v-if="body.pos" :position="body.pos.toAFrame()" :rotation="body.rot.toAFrame()">
			<a-cylinder radius="0.3" height=".2" :color="body.color.toHex()" shadow></a-cylinder>
			<a-cylinder radius="0.1" height=".2" position="0 0 .3" :color="body.color.toHex()" shadow></a-cylinder>
		</a-entity>
		
		<!--  HEAD AND TORSO -->
		
		<a-cylinder v-if="body.pos" 
			change-color-on-hover="color: blue"
			:position="body.pos.toAFrame(0, 1, 0)" radius="0.2" height=".5" :color="body.color.toHex()" shadow></a-cylinder>
		
		<a-entity v-if="body.head"
			:position="body.head.pos.toAFrame()"  
			:rotation="body.head.rot.toAFrame()"  
			>
			<a-entity 
				look-at="#camera"
				text="width: 10; value: Hello World;color:#000000; align:center" 
				position="0 1 0">
			</a-entity>

			<a-sphere :radius="body.headSize" :color="body.color.toHex(.4)" shadow></a-sphere>
			<a-cone 
				:position="nosePos"
				:radius-bottom="body.headSize*.2"  
				:height="body.headSize*.5" 
				:color="body.color.toHex(-.4)" shadow></a-cone>
		</a-entity>

		<!--  HANDS -->
		<a-entity v-if="body.hands">
			<a-entity v-for="hand in body.hands":key="hand.side" :position="hand.pos.toAFrame(0, 0, 0)">
				<a-sphere radius=".1"  :color="body.color.toHex(.4)" ></a-sphere>
			</a-entity>
		</a-entity>
	</a-entity>`,
	mounted() {
		console.log("body", this.body.head)
	},
	computed: {
		nosePos() {
			return `0 0 ${this.body.headSize}`
		}
	},
	props: ["body"]
})