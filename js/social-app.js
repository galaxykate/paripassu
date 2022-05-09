
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

Vue.component("room-debug", {
	template: `<div class="widget">
		<table>
			<tr>
				<td>Room ID</td>
				<td >{{room.id}}</td>
			</tr>
			<tr>
				<td>created by</td>
				<td >{{room.createdBy}}</td>
			</tr>
			<tr>
				<td>created on</td>
				<td >{{new Date(room.created).toLocaleString()}}</td>
			</tr>

			<tr v-if="room.user">
				<td>User ID</td>
				<td >{{room.user.uid}}</td>
			</tr>
		</table>
		
	</div>`,
	props: {room: {required: true}}
})

Vue.component("user-widget", {
	template: `<div class="widget user-widget">
		<div>
			<span ref="displayname">{{room.user.displayName}}</span>
			<button @click="editName=true">🖋</button>
		</div>
		<div v-if="editName">
			<input ref="displayname" v-model="room.user.displayName" v-on:keyup.enter="changeName"></input>
		</div>

	</div>`,
	methods: {
		changeName() {
			console.log(`change name to '${room.user.displayName}'`)
			room.postEvent({
				type: "changeName",
				data: {
					uid: this.room.user.uid,
					name: this.room.user.displayName
				}
			})
			this.editName = false
		},
	},
	data() {
		return {
			editName: false
		}
	},

	props: {"room": {required:true,type:Object}}
})



Vue.component("user-view", {
	template: `<div class="widget">
	Users:
	
		<table>
			<tr v-for="user in room.users" :class="{'user-row':true,active:user.status.connected}">
				<td>{{user.displayName}}</td>
				<td>{{user.id}}</td>
				<td>{{new Date(user.status.time).toLocaleString()}}</td>
			</tr>
		</table>
	</div>`,
	props: ["room"]
})


Vue.component("chat-message", {
	template: `<div class="chat-message">
		<div class="chat-message-bubble">{{msg.data}}</div>
	</div>`,
	props: ["msg", "user"]
})

Vue.component("chat", {
	template: `<div class="widget chat-widget">
		CHAT
		<chat-message v-for="msg in messages" :msg=msg :user="getUser(msg.from)" />

		<input v-model="msg" />
		<button @click="post">post</button>

	</div>`,
	methods: {
		getUser() {

		},
		post(){
			if (this.msg.length > 0)
				this.$emit("post", this.msg)
			this.msg = ""
		}
	},
	data() {
		return {
			msg: ""
		}
	},
	props:{"messages": {required:true,type:Array}}
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
					<chat :messages="room.messages" @post="sendChat" />

					
				</div>
				
				
			</div>
		
		<footer></footer>
		</div>`,
		
		data() {
			return {
				room: room,
	
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

