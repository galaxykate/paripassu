Vue.component("blackboard-dict", {
	template: `<table class="blackboard-dict">
		<tr v-for="(item, itemKey) in val" >
			<td>{{itemKey}}:</td>
			<td><blackboard-val :val="item"></td>
		</tr>
	</table>`,

	props: ["val"]	
})

Vue.component("blackboard-array", {
	template: `<div class="blackboard-array">
		<div v-for="(item,index) in val" class="blackboard-array-item">
			<span v-if="index > 0">,</span>
			<blackboard-val :val="item"/>
		</div>
	</div>`,

	props: ["val"]	
})


Vue.component("blackboard-val", {
	template: `

	<blackboard-array :val="val" v-if="Array.isArray(val)" />
	<blackboard-dict :val="val" v-else-if="typeof val == 'object'" />
	<div class="blackboard-val" v-else>{{val}}</div>

	`,

	props: ["val"]	
})


Vue.component("blackboard", {
	template: `<div class="blackboard">

		<blackboard-val :val="blackboard" />
	</div>`,

	props: ["blackboard"]	
})