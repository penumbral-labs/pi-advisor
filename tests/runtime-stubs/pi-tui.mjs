class Component {
	addChild() {}
	invalidate() {}
	render() { return []; }
}

export class Container extends Component {}
export class Spacer extends Component {}
export class Text extends Component {}
export class SelectList extends Component {
	setSelectedIndex() {}
	handleInput() {}
}
