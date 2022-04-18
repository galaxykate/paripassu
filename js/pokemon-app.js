const MAP_SIZE = 500
// const NU_CENTER = ol.proj.fromLonLat([-87.6753, 42.056])
const NU_CENTER = ol.proj.fromLonLat([-87.6813, 42.049])
const AUTOMOVE_SPEED = 1
const UPDATE_RATE = 100
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

// Create an interactive map
let map = new InteractiveMap({
	mapCenter: NU_CENTER,

	// Ranges
	ranges: [500, 200, 90, 1], // must be in reverse order

	landmarks:[
		// Custom landmarks
	], 

	initializeMap() {
		this.loadLandmarks("landmarks-shop-evanston", (landmark) => {
			// Keep this landmark?
			return true

			// Only keep this landmark if its a store or amenity
			// return landmark.properties.amenity || landmark.properties.store
		})

		
		// Create random landmarks
		// for (var i = 0; i < 10; i++) {

		// 	// make a polar offset (radius, theta) 
		// 	// from the map's center (units are *approximately* meters)
		// 	let position = clonePolarOffset(NU_CENTER, 400*Math.random() + 300, 20*Math.random())
		// 	this.createLandmark({
		// 		pos: position,
		// 		name: words.getRandomWord(),
		// 	})
		// }
	},

	update() {
		// Do something each frame
	},

	initializeLandmark: (landmark, isPlayer) => {
		// Add data to any landmark when it's created

		// Any openmap data?
		if (landmark.openMapData) {
			console.log(landmark.openMapData)
			landmark.name = landmark.openMapData.name
		}
		
		// You decide how to create a marker
		landmark.idNumber = landmarkCount++
		landmark.color = [Math.random(), 1, .5]

		// Give it a random number of points
		landmark.points = Math.floor(Math.random()*10 + 1)
		return landmark
	}, 

	onEnterRange: (landmark, newLevel, oldLevel, dist) => {
		// What happens when the user enters a range
		// -1 is not in any range

		console.log("enter", landmark.name, newLevel)
		if (newLevel == 2) {

			// Add points to my gamestate
			gameState.points += 1

			landmark.points += 1

			// Have we captured this?
			if (!gameState.captured.includes(landmark.name)) {
				gameState.captured.push(landmark.name)
			}

		}
	},

	onExitRange: (landmark, newLevel, oldLevel, dist) => {
		// What happens when the user EXITS a range around a landmark 
		// e.g. (2->1, 0->-1)
		
		console.log("exit", landmark.name, newLevel)
	},
	
	
	featureToStyle: (landmark) => {
		// How should we draw this landmark?
		// Returns an object used to set up the drawing

		if (landmark.isPlayer) {
			return {
				icon: "person_pin_circle",
				noBG: true // skip the background
			}
		}
		
		// Pick out a hue, we can reuse it for foreground and background
		let hue = landmark.points*.1
		return {
			label: landmark.name + "\n" + landmark.distanceToPlayer +"m",
			fontSize: 8,

			// Icons (in icon folder)
			icon: "person_pin_circle",

			// Colors are in HSL (hue, saturation, lightness)
			iconColor: [hue, 1, .5],
			bgColor: [hue, 1, .2],
			noBG: false // skip the background
		}
	},

	
})



window.onload = (event) => {


	const app = new Vue({
		template: `
		<div id="app">
		<header></header>
			<div id="main-columns">

				<div class="main-column" style="flex:1">
					(TODO, add your own gamestate)
					{{gameState}}
					
				</div>

				<div class="main-column" style="width:${MAP_SIZE}px;height:${MAP_SIZE}px">
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
			// "user-widget": userWidget,
			// "room-widget": roomWidget,
			"location-widget": locationWidget,
		}),

		el: "#app"
	})

};

