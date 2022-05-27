function initializeRoom(room) {
	// Add things to the room

	// Give everyone the same rocks
	// let rockCount = 0

	// let objFocus =new LiveObject(room, {
	// 	type: "cube",
	// 	color: new Vector(360, 100, 50),
	// 	size: new Vector(.5, .5, .5),
	// 	onUpdate({t,dt,frameCount}) {
	// 		let x = 1.4*noise(t*.5)
	// 		let y = 2.4*noise(t*.3)
	// 		let z = 1.1*noise(t*.4)
	// 		this.position.set(x,y, z)
			
	// 	}
	// })

	// // Make a number of rocks
	// // Each rock will *look at*
	// for (var i = 0; i < rockCount; i++) {
	// 	let h = .5 + .2*noise(i)

	// 	let obj = new LiveObject(room, {
	// 		label: "cube",
	// 		labelColor:new Vector(noise(i*.01)*360, 100, 50).toHex(),
	// 		type: "cube",
	// 		color: new Vector(noise(i*.01)*360, 100, 50),
	// 		size: new Vector(.1,.2, h),
	// 		onUpdate({t,dt,frameCount}) {
	// 			this.lookAt(objFocus.position)
	// 		}
	// 	})

	// 	// Set the rock in the ground, and point it toward the center
	// 	// it "looks" along its y-axis
	// 	let theta = i*Math.PI*2/rockCount
	// 	let r = 2
	// 	obj.position.setToCylindrical(r, theta, h*.5)
	// 	obj.lookAt(0,0,0)
	// }

}
