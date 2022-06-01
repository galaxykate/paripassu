
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

const LOCAL_UID = localStorage.getItem("local_uid") || "USER_" + uuidv4()
localStorage.setItem("local_uid", LOCAL_UID)

const urlSearchParams = new URLSearchParams(window.location.search);
const params = Object.fromEntries(urlSearchParams.entries());
let paused = false

let room = new Room()

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

			<div id="overlay" v-if="params.debug">
				<div>
					Name:<input v-model="room.tempDisplayName" />
				</div>
				<div>
					Auth: {{room.authID?room.authID.slice(0,7):"no auth"}}
				</div>

				<!-- LIVE OBJECTS --> 
			 	<div v-for="ev in room.events" :key="ev.uid" v-if="false">
			 		<table>
			 			<tr>
				 			<td>
				 				{{ev.type}}
				 			</td>
				 			<td>
				 				{{ev.data}}
				 			</td>
				 			
			 				
			 			</tr>
			 			
			 		</table>
			 		
			 	</div>

			 	<!-- LIVE OBJECTS --> 
			 	<div v-for="obj in room.objects" :key="obj.uid">
			 		<table>
			 			<tr>
				 			<td>
				 				{{obj.uid.slice(0,7)}}
				 				{{obj.paritype}}
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

