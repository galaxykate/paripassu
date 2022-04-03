
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


let gameState = {
	players: {},
	moveCount: 0,
	player: "none"
}

let room = new Room()

window.onload = (event) => {


	
	room.location = "NONE"
	room.join("test")

	room.on("move", (moves) => {
		moves.forEach(m => {
			path = m.path
			let root = gameState
			for (var i = 0; i < path.length - 1; i++) {
				let key = path[i]
				let key1 = path[i + 1]

				if (root[key] !== undefined) {
					root = root[key]
				} else {
					// This path is not there yet, construct it
					if (typeof key1 == 'string')
						Vue.set(root, key, {})
					else if (typeof key1 == 'int')
						Vue.set(root, key, [])
					else {
						console.warn("TODO, initialize path")
						root = undefined
					}
					
				}
			}
			let finalKey = path[path.length - 1]
			if (typeof root == "object")
				root[finalKey] = m.set
			else {
				console.log("Can't do move", m)
			}
		})

	})

	let start = Math.floor(Math.random()*100)
	let count = 0

	setInterval(() => {
		if (room.peerID) {
			count++
			let myID = room.peerID.slice(-4)
		
			let moves = [{
				path: ["moveCount"],
				set: Math.floor(Math.random()*100)
			},{
				path: ["player"],
				set: myID
			},{
				path: ["players", myID],
				set: .5 + .5 *Math.sin(start + count*.1)
			}]
			if (Math.random() > .5)
				room.move(moves)
		}
	}, 100) 

	// if (navigator.geolocation) {
	// 	navigator.geolocation.getCurrentPosition((pos) => {
	// 		room.location = [pos.coords.latitude, pos.coords.longitude]
	// 	});
	// }

	const eventchip = {
		template: `<div class="chip event-chip" :class="classes">
			
			<header>
				<div class="chip" v-if="event.from" :class="{'from-host':fromHost}">{{event.from.slice(-4)}}</div>
				<div>{{event.content.text}}</div>
			</header>
			

		</div>`,
		computed: {
			classes() {
				return {
					["event-chip-" + this.event.type]: true
				}
			},
			fromHost() {
				return this.room.roomID == this.event.from
			}
		},
		props: ["event", "room"],

	}

	const eventlog = {
		template: `
		<div class="event-log">
			<div>EVENTS:
			</div>
			<div>
				<event-chip v-for="event in events" :event="event" :room="room" />
			</div>
		</div>
		`,
		components: {
			"event-chip":eventchip
		},
		props: ["events", "room"]
	}

	const app = new Vue({
		template: `
		<div id="app">
		<header></header>
			<div id="main-columns">
				<div class="main-column" style="width:290px">

					<div class="panel">
						<peer-widget :room="room" />
					</div>
					
					<event-log :events="room.events" class="widget" :room="room"/> 
				</div>
				<div class="main-column" style="flex:1">
					
					<host-controls v-if="room.isHost" />

					<div>
					GEO:
					{{room.location}}
					</div>

					<div>
						{{gameState.moveCount}}
						<div>last move:{{gameState.player}}</div>

						<table>
							<tr v-for="(val,key) in gameState.players">
								<td>{{key}}</td>
								<td>
									<div class="fill-bar">
										<div class="fill" :style="{width:(val*100) + '%'}"></div>
									</div>
								</td>
								
							</tr>
						</table>

						
					</div>
				</div>

			</div>	
		<footer></footer>
		</div>`,
		data() {
			return {
				gameState: gameState,
				room:room
			}
		},

		methods: {
			post() {
				this.room.postMessage(words.getRandomWord())
			}
		},
		
		props: [],

		mounted() {
			
		},

		// Get all of the intarsia components, plus various others
		components: Object.assign({
			"event-log":eventlog,
			"peer-widget":peerWidget,
			"host-controls": hostControls,
		}),

		el: "#app"
	})

};

