/*
 * Event log visualizations
 * We can get events from loading localstorage, Peer, or FB
 */

const eventchip = {
	template: `<div class="chip event-chip" :class="classes">
		
		<header>
			<div class="microheader">
				<div class="microchip" v-if="event.uid">{{event.uid.slice(-4)}}</div>
				<div class="microchip" v-if="event.from">{{event.from.slice(-4)}}</div>
			</div>
			<div>{{outputTime}}</div>
			<div>{{event.type}}</div>
			<div v-if="event.content">{{event.content.text}}</div>

			<button @click="$emit('delete')">X</button>
		</header>
		

	</div>`,
	computed: {
		outputTime() {
			let d = new Date(this.event.date)
			return d.toLocaleTimeString()
		},
		classes() {
			return {
				["event-chip-" + this.event.type]: true
			}
		},
		
	},
	props: ["event"],

}

const eventlog = {
	template: `
	<div class="event-log">
		<div>EVENTS:
		</div>
		<div>
			<event-chip 
				v-for="event in eventLog.events" 
				@delete="eventLog.deleteEvent(event)" 
				:event="event"
				:key="event.uid"
				:eventLog="eventLog" />
		</div>

		<button @click="eventLog.deleteAllEvents()">clear all</button>
	</div>
	`,


	components: {
		"event-chip":eventchip
	},
	props: ["eventLog"]
}