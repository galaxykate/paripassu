
Vue.component("game", {
	template: `<div class="game">
		<header>GAME {{game.currentState}}</header>
		<div class="content">

		</div>
		<footer></footer>
	</div>`,

	props: ["game"]
})

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
		<div v-if="false">
			<span ref="displayname">{{room.user.displayName}}</span>
			<button @click="editName=true">🖋</button>
		</div>
		<div >
			<input ref="displayname" v-model="room.user.displayName" v-on:keyup.enter="changeName"></input>
			<input ref="colorpicker" v-model="room.user.color" type="color" @change="changeColor"></input>
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
		changeColor() {
			console.log(`change color to '${room.user.color}'`)
			room.postEvent({
				type: "changeColor",
				data: {
					uid: this.room.user.uid,
					color: this.room.user.color
				}
			})
		},
	},
	data() {
		return {
			editName: false
		}
	},

	props: {"room": {required:true,type:Object}}
})

Vue.component("user-chip", {
	template: `<div class="chip user-chip" tabindex=0 @focus="" :style="style">
		<div class="user-displayname" >{{user.displayName}}</div>
		<div class="user-uid microchip">{{user.id}}</div>
	</div>`,
	computed: {
		style() {
			if (this.user && this.user.color)
				return {
					backgroundColor: this.user.color
				}
		}
	},
	props: ["user"]
})

Vue.component("user-view", {
	template: `<div class="widget">
	Users:
	
		<table>
			<tr v-for="user in room.users" :class="{'user-row':true,active:user.status.connected}">
				<td><user-chip :user="user" /></td>
				<td>{{new Date(user.status.time).toLocaleString()}}</td>
			</tr>
		</table>
	</div>`,
	props: ["room"]
})


Vue.component("chat-message", {
	template: `<div class="chat-message">
		<user-chip :user="user" />
		<div class="chat-message-bubble">{{msg.data}}</div>

	</div>`,
	computed: {
		style() {
			let color = this.user.color
			console.log(color)
			return {
				backgroundColor: color
			}
		}
	},
	props: ["msg", "user"]
})

Vue.component("chat", {
	template: `<div class="widget chat-widget">
		
		<div class="chat-messages" ref="messages">
			<chat-message v-for="msg in messages" :msg=msg :user="getUser(msg.from)" />
		</div>
		<input v-model="msg" v-on:keyup.enter="post" />
		<button @click="post">post</button>

	</div>`,
	watch: {
		messages() {
			// Scroll to bottom of messages
			var container = this.$refs.messages;
			container.scrollTop = container.scrollHeight;
		}
	},
	methods: {
		getUser(uid) {
			return this.users[uid]
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
	props:{"messages": {required:true,type:Array}, "users": {}}
})



const userWidget = {
	template: `<div class="panel">
		<table>
			<tr>
				<td>uid</td>
				<td>{{user.uid}}</td>
			</tr>
			<tr>
				<td>name</td>
				<td><input v-model="user.displayName"></input></td>
			</tr>
		</table>	
	</div>
	`,
	methods: {
		
	},
	props: {
		user: {}
	}
}




// Widget look at location data
const locationWidget = {
	template: `
	<div class="widget widget-location">
		<div class="controls">
			<button @click="map.useLocation = !map.useLocation">use real location</button>
			<button @click="map.automove = !map.automove">automove</button>

		</div>
		<table>

		<tr >
		<td>Location: {{map.userLocation}}</td>
		
		</tr>	
		
		</table>

		<div class="map" id="map"></div>

		<div class="popup" ref="popup"></div>


	</div>`,

	methods: {
		
	},

	watch: {
		"location.pos": function() {
			// console.log("Location changed")
			// console.log(this.map)
			// console.log("set center", this.location.pos)
			// let center = this.location.pos.slice(0,2)
			// // center = ol.proj.fromLonLat(this.location.pos[1], this.location.pos[0], 'EPSG:4326', 'EPSG:3857')

			// // center = ol.proj.transform([77.216574, 28.627671])
			// console.log(center)
			// // center = new ol.LonLat(center[1], center[0]).transform('EPSG:4326', 'EPSG:3857')
			// this.map.getView().setCenter(ol.proj.fromLonLat(center));
			// this.map.getView().setZoom(15)

		}
	},

	mounted() {
		map.renderMap("map", this.$refs.popup)
		
		// setInterval(() => {
		// 	console.log("Create new")
		// 	console.log(NU_CENTER)
		// 	let p = NU_CENTER.clonePolarOffset(100, Math.random())
		// 	console.log(p)
		// 	var marker = new ol.Feature({
		// 		name: "TEST",
		// 		geometry: new ol.geom.Point(p)
		// 	});

		// 	markers.getSource().addFeature(marker);

		// }, 1000) 

		
	},

	
	props: ["map"],

}



// Widget to track the connections to peers and the peer server
const roomWidget = {
	template: `
	<div class="widget widget-peer">
	<table>

	<tr >
	<td>Room:</td>
	<td>{{room.roomID}} <b>({{room.role}})</b></td>

	</tr>	
	<tr >
	<td>Players:</td>
	</tr>	
	<tr v-for="(user, index) in room.users">

	<td>{{index + 1}}</td>
	<td>
	{{room.getDisplayName(user.uid)}}
	</td>
	<td>
	<div class="microchip">{{user.uid.slice(-4)}}</div>
	{{room.getUserStatus(user.uid)}}
	</td>
	</tr>	

	</table>

	

	</div>`,

	methods: {
		getStatus(conn) {
			if (conn._open)
				return "open"
			if (conn.closedOn)
				return "closed"
			return "---"
		}
		
	},
	props: ["room"],

}
