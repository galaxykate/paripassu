

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
