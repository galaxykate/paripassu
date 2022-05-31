const fakeBodyCount = 10
const fakeBodySteps = 1000

// Decorate the head of our guests
Vue.component("obj-head", {
	template: `<a-entity>
		<a-sphere 
			shadow
			:radius="headSize"
			:color="obj.color.toHex()" 
				
			>
			
		</a-sphere>
		
		<a-sphere 
		:color="obj.color.toHex()"  
		position="0 0 0" 
		:depth="headSize" 
		:height="headSize" 
		:radius="headSize">
		</a-sphere>

		<a-sphere 
		:color="obj.color.toHex()"  
		position="0 0 -.2" 
		:depth="headSize*.5" 
		:height="headSize*.3" 
		:radius="headSize*.2">
		</a-sphere>

		<a-cylinder 
		:color="obj.color.toHex()"
		position="0 .16 0" 
		:depth="headSize" 
		:height="headSize*.3" 
		:radius="headSize*1.1">
		</a-cylinder>

		<a-cylinder 
		:color="obj.color.toHex()" 
		position="0 .18 0" 
		:depth="headSize*.5" 
		:height="headSize*2" 
		:radius="headSize*.75">
		</a-cylinder>
		
	</a-entity>
	`,
	computed: {
		color() {
			return this.obj.color.toHex?this.obj.color.toHex():this.obj.color
		},
		headSize() {
			return this.obj.size instanceof Vector ? this.obj.size.x : this.obj.size
		},
	},

	// data() {
	// 	let spikeCount = 5
	// 	let spikes = []

	// 	for (var i = 0; i < spikeCount; i++) {
	// 		let h = .1
	// 		let spike = new LiveObject(undefined, { 
	// 			size: new THREE.Vector3(h*.2, h, h*.2),
	// 			color: new Vector(noise(i)*30 + 140, 0, 40 + 20*noise(i*3))
	// 		})
	// 		let r = .2
	// 		// Put them on the other side
	// 		let theta = 2*noise(i*10) + 3
	// 		spike.position.setToCylindrical(r, theta, h*.3)
	// 		// Look randomly
	// 		spike.lookAt(0, 3, 0)
	// 		spikes.push(spike)
	// 	}

	// 	return {
	// 		spikes: spikes
	// 	}
	// },

	mounted() {
		console.log(this.headSize)
	},
	props: ["obj"]
})


Vue.component("obj-fire", {
	template: `
	<a-entity>
		<a-sphere 
			color="grey"
			radius=2 
			scale="1 .3 1" 
			roughness=1
			segments-height="5"
			segments-width="10"
			theta-start=0
			theta-length=60
			position="0 -.4 0"
			>
		</a-sphere>
		<a-cone
			position="0 .2 0"
			@click="click"
			:animation="heightAnimation"
			:color="obj.color.toHex()"
			height=.2
			radius-bottom=".4"

			:scale="(obj.fireStrength*.2 + 1) + ' ' + .1*obj.fireStrength + ' ' + (obj.fireStrength*.2 + 1)"
			:material="fireMaterial">

		</a-cone>

		<a-light
			:animation="intensityAnimation"

			position="0 1 0"
			intensity="2"
			:color="obj.color.toHex()"
			type="point"
			:distance="obj.fireStrength*4 + 10"
			decay="2">
		</a-light>
	</a-entity>

	`,

	// Values computed on the fly
	computed: {
		fireMaterial() {
			return `emissive:${this.obj.color.toHex(.2)}`
		},
		
		animationSpeed() {
			return 500
		},
		intensityAnimation() {
			return `property: intensity; from:.3; to:.6; dir:alternate;dur: ${this.animationSpeed}; easing:easeInOutQuad;loop:true`
		},
		heightAnimation() {
			return `property: height; from:${this.obj.fireStrength};to:${this.obj.fireStrength*2}; dir:alternate;dur: 500; easing:easeInOutQuad;loop:true`
		}
	},

	methods: {
		click() {
			this.obj.fireStrength += 1
			this.obj.fireStrength = this.obj.fireStrength%10 + 1

			// Tell the server about this action
			this.obj.post()
		}
	},

	// this function runs once when this object is created
	mounted() {

	},



	props: ["obj"]


})



Vue.component("obj-world", {

	template: `
	<a-entity>
		<!--------- SKYBOX --------->
		<a-sky color="lightblue" change-image></a-sky>

		<a-plane 
			roughness="1"
			shadow 
			color="hsla(300, 70%, 67%, 1)"
			height="100" 
			width="100" 
			rotation="-90 0 0">
		</a-plane>

		<!---- lights ----> 
		<a-entity light="type: ambient; intensity: 0.4;" color="white"></a-entity>
		<a-light type="directional" 
			position="0 0 0" 
			rotation="-90 0 0" 
			intensity="0.4"
			castShadow target="#directionaltarget">
			<a-entity id="directionaltarget" position="-10 0 -20"></a-entity>
		</a-light>

		<a-cone 
			v-for="(tree,index) in trees"
			:key="'tree' + index"
			shadow 

			:color = "tree.color"
			:base-radius="tree.size.z" 
			:height="tree.size.y" 

			segments-radial=10
			segments-height=1
			
			:rotation="tree.rotation.toAFrame()"
			:position="tree.position.toAFrame()">
		</a-cone>

		// <a-sphere 
		// 	v-for="(tree,index) in trees"
		// 	:key="'tree' + index"
		// 	shadow 

		// 	:color = "tree.color"
		// 	:radius="tree.size.z + 2"

			
		// 	:rotation="tree.rotation.toAFrame()"
		// 	:position="tree.position.toAFrame()">
		// </a-sphere>

		

		<a-entity>
            <a-cylinder color="green" height="7" radius=".05" position="4 0 0" ></a-cylinder>
            <a-cylinder color="blue" height="7" radius=".05" position="0 0 -4" ></a-cylinder>
            <a-cylinder color="crimson" height="9" radius=".05" position="0 0 4" ></a-cylinder>
            <a-cylinder color="yellow" height="5" radius=".05" position="-4 0 0" ></a-cylinder>

            <a-triangle 
                color="orange" 
                roughness="1"
                vertex-a = "4 3.5 0"
                vertex-b = "0 4.5 4"
                vertex-c = "0 3.5 -4"
                material="side:double">
            </a-triangle>

			<a-triangle 
                color="purple" 
                roughness="1"
                vertex-a = "-4 2.5 0"
                vertex-b = "4 3.5 0"
                vertex-c = "0 3.5 -4"
                material="side:double">
            </a-triangle>
        </a-entity>

		<a-box 
			v-for="(rock,index) in rocks"
			:key="'rock' + index"
			shadow 

			roughness="1"

			:color="rock.color"
			:width="rock.size.x" 
			:depth="rock.size.z" 
			:height="rock.size.y" 
			
			:rotation="rock.rotation.toAFrame()"
			:position="rock.position.toAFrame()">
		</a-box>


		<plate>

	</a-entity>
		`,

	data() {
		// Where we setup the data that this *rendered scene needs*

		// EXAMPLE: Generated landscape
		// Make some random trees and rocks
		// Create a lot of LiveObjects (just as a way 
		//  to store size and color conveniently)
		// Interpret them as whatever A-Frame geometry you want!
		// Cones, spheres, entities with multiple ...things?
		// If you only use "noise" and not "random", 
		// everyone will have the same view. (Wordle-style!)

		function generateRandomColor() {
			var letters = '0123456789ABCDEF';
			var color = '#';
			for (var i = 0; i < 6; i++) {
				color += letters[Math.floor(Math.random() * 16)];
			}
			return color;
		}

		console.log(generateRandomColor())
		let trees = []
		let count = 30
		for (var i = 0; i < count; i++) {
			let h = 6 + 4*noise(i) // Size from 1 to 3
			let tree = new LiveObject(undefined, { 
				size: new THREE.Vector3(.3, h, .3),
				color: generateRandomColor()//new Vector(noise(i*50)*30 + 40, 200, 160 + 10*noise(i*10))
				
			})
			let r = 20 + 10*noise(i*40)
			let theta = 2*noise(i*10)
			tree.position.setToCylindrical(r, theta, h/2)
			tree.lookAt(0,1,0)
			trees.push(tree)
		}


		let rocks = []
		let rockCount = 25
		for (var i = 0; i < rockCount; i++) {
			let h = 1.2 + noise(i*100) // Size from 1 to 3
			let rock = new LiveObject(undefined, { 
				size: new THREE.Vector3(h, h, h),
				color: generateRandomColor()//new Vector(noise(i)*30 + 140, 0, 40 + 20*noise(i*3))
			})
			let r = 4 + 1*noise(i*1)
			// Put them on the other side
			let theta = 2*noise(i*10) + 3
			rock.position.setToCylindrical(r, theta, h*.3)
			// Look randomly
			rock.lookAt(Math.random()*100,Math.random()*100,Math.random()*100)
			rocks.push(rock)
		}


		return {
			trees: trees,
			rocks: rocks
			// boxes: []
		}
	},

	mounted() {
		// Create a fire object
		// Attach this liveobject to the ROOM
		// and then the room deals with drawing it to AFRAME
		let fire = new LiveObject(this.room, {
			paritype: "fire",  // Tells it which type to use
			uid: "fire0",
			onUpdate({t, dt, frameCount}) {
				let hue = (noise(t*.02)+1)*180
				Vue.set(this.color.v, 0, hue)
				
				// console.log(this.color[0] )
			}
		})

		fire.position.set(1, 0, -2)
		fire.fireStrength = 1

		// let fire2 = new LiveObject(this.room, {
		// 	paritype: "fire",  // Tells it which type to use
		// 	uid: "fire2",
		// 	onUpdate({t, dt, frameCount}) {
		// 		let hue = (noise(t*.02)+1)*180
		// 		Vue.set(this.color.v, 0, hue)
				
		// 		// console.log(this.color[0] )
		// 	}
		// })

		// fire2.position.set(3, 0, -4)
		// fire2.fireStrength = 7

		
		let grammar = new tracery.createGrammar(  {
			songStyle : ", played as #song.a#, on #musicModifier# #instrument#",
			instrument : ["ukulele", "vocals", "guitar", "clarinet", "piano", "harmonica", "sitar", "tabla", "harp", "dulcimer", "violin", "accordion", "concertina", "fiddle", "tamborine", "bagpipe", "harpsichord", "euphonium"],
			musicModifier : ["heavy", "soft", "acoustic", "psychedelic", "light", "orchestral", "operatic", "distorted", "echoing", "melodic", "atonal", "arhythmic", "rhythmic", "electronic"],
			musicGenre : ["metal", "electofunk", "jazz", "salsa", "klezmer", "zydeco", "blues", "mariachi", "flamenco", "pop", "rap", "soul", "gospel", "buegrass", "swing", "folk"],
			musicPlays : ["echoes out", "reverberates", "rises", "plays"],
			musicAdv : ["too quietly to hear", "into dissonance", "into a minor chord", "changing tempo", "to a major chord", "staccatto", "into harmony", "without warning", "briskly", "under the melody", "gently", "becoming #musicGenre#"],
			song : ["melody", "dirge", "ballad", "poem", "beat poetry", "slam poetry", "spoken word performance", "hymn", "song", "tone poem", "symphony"],
			musicAdj : ["yielding", "firm", "joyful", "catchy", "folksy", "harsh", "strong", "soaring", "rising", "falling", "fading", "frantic", "calm", "childlike", "rough", "sensual", "erotic", "frightened", "sorrowful", "gruff", "smooth"],
        
		}, {})
		grammar.addModifiers(baseEngModifiers)

		const campfireSongs = ["Lonely Goatherd", "On top of spaghetti", "Princess Pat", "BINGO", "Old Mac Donald", "Going on a Bear Hunt", "The Green Grass Grew All Around", "Home on the Range", "John Jacob Jingleheimer Schmitt", "The Wheels on the Bus", "If I had a Hammer"]
		this.room.detailText = "Campfire time!"

		this.room.time.onSecondChange((second) => {
			// Change the song every minute (60 seconds)
			let rate = 10 // How many seconds between changes
			if (second%rate === 0) {
				let tick = second/rate
				let index = second % campfireSongs.length
				let song = campfireSongs[index]
				this.room.detailText =  song + grammar.flatten("#songStyle#")
			}
		})

		// let count = 10

		// for (var i = 0; i < count; i++) {
		// 	let r = 5
		// 	let theta = Math.PI*2*i/count

		// 	this.boxes.push({
		// 		pos: Vector.polar(r, theta, "y"),
		// 		rot: new Vector(0, -theta*180/Math.PI, 0),
		// 		size: Math.random()*1
		// 	})


		// }
		// console.log(this.boxes)


	},

	props: ["room"]

})

