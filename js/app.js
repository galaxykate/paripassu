
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

let room = new Room()

window.onload = (event) => {

	console.log("START APP")

	Vue.config.ignoredElements = [/^a-/];

	Vue.component("vector", {
		template: `<div class="vector">{{label}}:{{v}}</div>`,
		props: ["v", "label"]
	})

	new Vue({
		template: `<div>

			<div id="scenevector">
				<room-scene :room="room" />
			</div>

			<div id="overlay">
			 	<div v-for="body in room.bodies" :key="body.id">
			 		{{body}}
			 		
			 	</div>
			</div>
		</div>`, 

		data() {
			return {
				room: room // Give Vue access to the room and its data
			}
		},

		el:"#app"
	}) 
};

