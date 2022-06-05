function initializeRoom(room) {
  //   Add things to the room
  //   Give everyone the same rocks
  let rockCount = 5;
  let objFocus = new LiveObject(room, {
    type: "cube-center",
    color: new Vector(360, 100, 50),
    size: new Vector(0.05, 0.05, 0.05),
    onUpdate({ t, dt, frameCount }) {
      let x = 1.4 * noise(t * 0.5);
      let y = 2.4 * noise(t * 0.3);
      let z = 1.1 * noise(t * 0.4);
      this.position.set(x, y, z);
    },
  });
  // Make a number of rocks
  // Each rock will *look at*
  for (var i = 0; i < rockCount; i++) {
    let h = 0.5 + 0.2 * noise(i);
    let obj = new LiveObject(room, {
      label: "cube",
      labelColor: new Vector(noise(i * 0.01) * 360, 100, 50).toHex(),
      type: "cube",
      color: new Vector(Math.random() * 360, 100, 50),
      size: new Vector(h, h, h),
      onUpdate({ t, dt, frameCount }) {
        this.lookAt(objFocus.position);
      },
    });
    // Set the rock in the ground, and point it toward the center
    // it "looks" along its y-axis
    let theta = (i * Math.PI * 2) / rockCount;
    let r = 2;
    obj.position.setToCylindrical(r, theta, h * 0.5);
    obj.lookAt(0, 0, 0);
  }
}
