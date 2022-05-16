window.onload = () => {
	let obj = {
		"test": ["foo", {x: 5}]
	}


	new Vue({
		template: `<div>
			<blackboard :blackboard="obj" />
		</div>`,
		el: "#app",
		data() {
			return {
				obj:obj
			}
		}
	})

	setAtPath(obj, ["bar", 0, "x"], 47)
	setAtPath(obj, ["bar", 1, "y"], 47)
	// setAtPath(obj, ["bar", "z"], 47)
	setAtPath(obj, ["fizz", "z"], 47)

	let pathWords = []
	for (var i = 0; i < 6; i++) {
		pathWords[i] = words.getRandomWord()
	}

	function randomPath() {
		let path = []
		let count = Math.floor(Math.random()**1*3 + 1)
		for (var j = 0; j < count; j++) {
			let s = getRandom(pathWords)
			if (Math.random()> .3)
				s = Math.floor(Math.random()*2)
			path.push(s)
		}
		return path
	}
	// for (var i = 0; i < 10; i++) {
		
	// 	try {
	// 			setAtPath(obj, randomPath(), 47)
	// 		}
	// 	catch(err) {
	// 		console.warn(err)
	// 	}
	// 	// console.log(JSON.stringify(obj, null, 2))
	
	// }

	setInterval(() => {
		try {
			setAtPath(obj, randomPath(), Math.floor(Math.random()*100))
		}
		catch(err) {
			console.warn(err)
		}
	}, 20) 
	// for (var i = 0; i < 300; i++) {
		
	// 	try {
	// 			let path = randomPath()
	// 			let x = getAtPath(obj, path, 47)
	// 			console.log(x, path)
	// 		}
	// 	catch(err) {

	// 	}
	// }



	// console.log(getAtPath(obj, ["test", 3, "x"], true))
	
}