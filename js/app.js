
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
const urlSearchParams = new URLSearchParams(window.location.search);
const params = Object.fromEntries(urlSearchParams.entries());
let paused = false

// Pause on space
document.onkeyup = function(e) {
  if (e.key == " " ||
      e.code == "Space" ||      
      e.keyCode == 32      
  ) {
    paused = !paused
  }
}

window.onload = (event) => {

	console.log("START APP")



	Vue.config.ignoredElements = [/^a-/];
	Vue.component("vector", {
		template: `<div class="vector">{{label}}:{{v}}</div>`,
		props: ["v", "label"]
	})

	new Vue({
		template: `<div>
		
			<div id="scene">
				<room-scene :room="room" v-if="!params.noaframe" />
			</div>

			<div id="overlay">
			 	<div v-for="obj in room.objects" :key="obj.uid">
			 		<table>
			 			<tr>
				 			<td>
				 				{{obj.uid.slice(-4)}}
				 			</td>
				 			<td>
				 				pos:{{obj.position.toFixed(2)}}
				 			</td>
				 			<td>
				 				rot:{{obj.rotation.toFixed(2)}}
				 			</td>
				 			
			 				
			 			</tr>
			 			
			 		</table>
			 		
			 	</div>

			</div>
		</div>`, 

		data() {
			return {
				params: params,
				room: room // Give Vue access to the room and its data
			}
		},

		el:"#app"
	})

};

