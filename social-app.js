
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

let room = new Room(params["room"] || "test")
let game = new Game({

	states: {
		origin: "<div>HELLO</div>"
	}
})

window.onload = (event) => {

	// Create a room
	
	const app = new Vue({
		template: `
		<div id="app">
		<header></header>
			<div id="main-columns">

				<div class="main-column" style="width:400px">
					<room-debug :room="room" />
					<user-view  :room="room" />
					<user-widget :room="room" />
					<chat :messages="room.messages" @post="sendChat" :users="room.users" />

					
				</div>
				
				<div class="main-column" style="flex:1">
					<game v-if="false" :game="game" />
					<div>
						<table>
							<tr v-for="(user, uid) in room.users">
								<td>{{uid}}<td/>
								<td>{{user.displayName}}<td/>
							</tr>
						</table>
					</div>

					<div>
						<button @click="giveMePoint">score</button>
					</div>

					<div>
						<table>
							<tr v-for="(value, uid) in room.currentScores">
								<td>{{uid}}<td/>
								<td>{{value}}<td/>
							</tr>
						</table>
						
					</div>
					<div v-for="ev in room.getEventsByType('point')">
						{{ev.data}}
					</div>
					
				</div>
			</div>
		
		<footer></footer>
		</div>`,
		
		data() {
			return {
				// All the social stuff
				room: room,

				// Gameplay?
				// game: game,
			}
		},

		methods: {
			giveMePoint() {
				console.log("I get a point")
				room.postEvent({
					type: "point",
					data: {
						to: room.user.id,
						count: 1
					}
				})
			},
			sendChat(msg) {
				

				this.room.postEvent({
					type: "chat",
					data: msg
				})
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
			// "event-log": eventlog,
			// "user-widget": userWidget,
			// "room-widget": roomWidget,
			// "location-widget": locationWidget,
		}),

		el: "#app"
	})

};

