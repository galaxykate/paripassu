const NU_CENTER = ol.proj.fromLonLat([-87.6753, 42.056])



/*
 Apps are made out of a header (title/controls) and footer
 and some number of columns
 If its vertical, the columns can become sections in one column
 */

let landmarkCount = 0
let map = new InteractiveMap({
	mapCenter: NU_CENTER,
	landmarks:[
		// Custom landmarks
	], 
	landmarkToMarker: (landmark) => {
		landmark.idNumber = landmarkCount++
		landmark.color = [Math.random(), 1, .5]
		return landmark
	}, 
	
	update: (frameCount) => {
		// Do something every frame
		moveMarker({
			marker:map.playerMarker,
			r: 40,
			theta: 10*noise.noise2D(frameCount*.1, 1),
			lerpTo:NU_CENTER,
			lerpAmt: .01
		})
	}
})

// map.loadLandmarks("landmarks-interesting-nu", (landmark) => {
// 	// Keep this landmark?
// 	return landmark.properties.amenity || landmark.properties.store
// })

window.onload = (event) => {


	const app = new Vue({
		template: `
		<div id="app">
		<header></header>
			<div id="main-columns">

				<div class="main-column" style="width:290px">

					<div class="panel">
						<user-widget :user="io.user" />
						<room-widget :room="io.room" />
					</div>
					
					<event-log :eventLog="io.room.eventLog" class="widget"/> 

					<button @click="io.post({type:'test'})">test post</button>
				</div>

				<div class="main-column" style="flex:1">
					<button>enable geolocation 🌎</button>
					<location-widget :map="map" />
				
				</div>

			</div>	
		<footer></footer>
		</div>`,
		data() {
			return {
				// gameState: gameState,
				io:io,
				map: map
			}
		},

		methods: {

			sendMessage() {
				console.log(this.$refs)
				let msg = this.$refs.message.value
				console.log(msg)

				this.$refs.message.value = ""
				this.room.sendMessage(msg)
			},
			
			post() {
				this.room.postMessage(words.getRandomWord())
			}
		},
		
		props: [],

		mounted() {
			
		},

		// Get all of the intarsia components, plus various others
		components: Object.assign({
			"event-log": eventlog,
			"user-widget": userWidget,
			"room-widget": roomWidget,
			"location-widget": locationWidget,
		}),

		el: "#app"
	})

};

