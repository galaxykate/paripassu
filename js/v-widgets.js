const hostControls = {
	template: `<div class="panel">
		<button @click="clearEvents">clear events</button>
	</div>
	`,
	methods: {
		clearEvents() {
			
			this.room.clearEvents()
		}
	},
	props: {
		room:{
			isRequired: true
		}
	}
}





// Widget to track the connections to peers and the peer server
const peerWidget = {
	template: `
	<div class="widget widget-peer">
	<table>
		
		<tr >
			<td>Room:</td>
			<td>{{room.roomID}} <b>({{room.role}})</b></td>
		</tr>	
	

		<tr >
			<td>PeerServer:</td>
			<td>{{room.peerStatus}}</td>
		</tr>

		<tr v-if="room.peerID">
			<td>peerID: </td>
			<td><span v-if="room.isHost">⭐️</span>{{room.peerID.slice(-4)}}</td>
		</tr>

		<tr v-if="room.hostConnection">
			<td>→host: </td>
			<td>{{getStatus(room.hostConnection)}}</td>
		</tr>

		<tr v-for="conn in room.guestConnections">
			<td>→{{conn.peer.slice(-4)}}: </td>
			<td>{{getStatus(conn)}}</td>
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
