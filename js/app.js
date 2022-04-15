
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



window.onload = (event) => {

	io.startIO()

	// for (var i = 0; i < 4; i++) {
	// 	room.sendMessage(words.getRandomWord())	
	// }
	
	// room.on("move", (moves) => {
	// 	moves.forEach(m => {
	// 		path = m.path
	// 		let root = gameState
	// 		for (var i = 0; i < path.length - 1; i++) {
	// 			let key = path[i]
	// 			let key1 = path[i + 1]

	// 			if (root[key] !== undefined) {
	// 				root = root[key]
	// 			} else {
	// 				// This path is not there yet, construct it
	// 				if (typeof key1 == 'string')
	// 					Vue.set(root, key, {})
	// 				else if (typeof key1 == 'int')
	// 					Vue.set(root, key, [])
	// 				else {
	// 					console.warn("TODO, initialize path")
	// 					root = undefined
	// 				}
					
	// 			}
	// 		}
	// 		let finalKey = path[path.length - 1]
	// 		if (typeof root == "object")
	// 			root[finalKey] = m.set
	// 		else {
	// 			console.log("Can't do move", m)
	// 		}
	// 	})

	// })

	let start = Math.floor(Math.random()*100)
	let count = 0

	// setInterval(() => {
	// 	if (room.peerID) {
	// 		count++
	// 		let myID = room.peerID.slice(-4)
		
	// 		let moves = [{
	// 			path: ["moveCount"],
	// 			set: Math.floor(Math.random()*100)
	// 		},{
	// 			path: ["player"],
	// 			set: myID
	// 		},{
	// 			path: ["players", myID],
	// 			set: .5 + .5 *Math.sin(start + count*.1)
	// 		}]
	// 		if (Math.random() > .5)
	// 			room.move(moves)
	// 	}
	// }, 100) 


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
					<location-widget :location="io.location"/>
				
				</div>

			</div>	
		<footer></footer>
		</div>`,
		data() {
			return {
				// gameState: gameState,
				io:io
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

