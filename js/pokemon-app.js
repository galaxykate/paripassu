const NU_CENTER = ol.proj.fromLonLat([-87.6753, 42.056])



/*
 Apps are made out of a header (title/controls) and footer
 and some number of columns
 If its vertical, the columns can become sections in one column
 */


let landmarkCount = 0

let gameState = {
	points: 0,
	captured: []
}

let map = new InteractiveMap({
	mapCenter: NU_CENTER,

	range: 100,

	landmarks:[
		// Custom landmarks
	], 
	landmarkToMarker: (landmark) => {
		landmark.idNumber = landmarkCount++
		landmark.color = [Math.random(), 1, .5]
		return landmark
	}, 

	onEnterRange: (landmark, dist) => {

	},

	onExitRange: (landmark, dist) => {

	},
	
	update: (frameCount) => {
		// Do something every frame
		
	}
})

map.loadLandmarks("landmarks-natural-nu", (landmark) => {
	// Keep this landmark?
	return true
	// return landmark.properties.amenity || landmark.properties.store
})




window.onload = (event) => {


	const app = new Vue({
		template: `
		<div id="app">
		<header></header>
			<div id="main-columns">

				<div class="main-column" style="width:290px">
					{{gameState}}
					
				</div>

				<div class="main-column" style="flex:1">
					<location-widget :map="map" />
				
				</div>

			</div>	
		<footer></footer>
		</div>`,
		data() {
			return {
				// gameState: gameState,
				io:io,
				map: map,
				gameState: gameState
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

