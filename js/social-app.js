
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
					<game :game="game" />
				</div>
			</div>
		
		<footer></footer>
		</div>`,
		
		data() {
			return {
				room: room,
				game: game,
			}
		},

		methods: {
			
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

