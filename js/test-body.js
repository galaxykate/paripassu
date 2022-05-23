// Simulated VR body, with optional head, hands, finger data



class TestBody {
	constructor() {
		this.pos = new Vector(Math.random()*4, 0, Math.random()*4)
		
		this.color = new Vector(Math.random()*360, 100, 50)

		// Everyone has a head, with a direction
		// Head-tracked are
		this.head = {
			pos: new Vector(),
			rot: new Vector()
		}

		this.height = 1.6 + Math.random()*.1
		this.phi = Math.PI/2 - .1
		this.theta = Math.random() 
		this.idNumber = Math.floor(Math.random()*10000)

		this.v = new Vector(0, 0, 0)
		this.f = new Vector(0, 0, 0)

		this.addHands()
	}


	addHands() {
		this.hands = []

		for (var i = 0; i < 2; i++) {
			this.hands[i] = {
				side: i*2 - 1,
				phi: 0,
				theta: 0,
				length: .6,
				pos: new Vector(),
				rot: [0,0,0]
			}
		}
	}


	update(t, dt) {
		
		let wanderDir = 20*noise(this.idNumber + t*.1)
		this.f.setToPolar(1, wanderDir, 'y')
		this.f.addMultiples(this.pos, -.2)

		this.v.addMultiples(this.f, dt)
		this.v.mult(.96)
		this.pos.addMultiples(this.v, dt)
		
		this.phi = noise(t*.1)
		this.theta = -Math.atan2(this.v.v[2], this.v.v[0]) + Math.PI/2
		// console.log(this.theta)

		// console.log(dt)
		// console.log(this.pos.toFixed(2))
		// console.log(this.v.toFixed(2))

		// Figure out the current hand position
		// Transform relative to the body
		if (this.hands) {
			this.hands.forEach(h => {
				// Angle of spread
				h.theta = h.side*(Math.PI*.2 + .5* noise(this.idNumber + h.side + .6*t))
				// h.theta = .4*h.side
				h.phi = 1.2*noise(this.idNumber + h.side + .2*t) - .4
				// h.pos.setTo
			})
		}

	}

	get id() {
		return "FAKE_" + this.idNumber
	}

	toBodyData() {

		let rotTheta = this.theta*180/Math.PI
		let head = {
			pos: this.pos.cloneOffset(0, this.height, 0),
			rot: [0,rotTheta,this.phi*180/Math.PI]
		}

		return {
			hands: this.hands.map(h=>{
				let pos = new Vector(this.pos)
				pos.v[1] += this.height*.8
				pos.addSpherical(h.length, h.theta + -this.theta + Math.PI/2, h.phi, "y")
				return {
					pos: pos.toArray()
				}
			}), 
			color: this.color.toArray(),
			head: copyObject(head, {toArray: true}),
			pos: this.pos.toArray(),
			rot: [0, rotTheta, 0]
		}
	}
}

