import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { Greeting } from '../greeting.js'

describe('greeting', () => {
    it('should render the name', () => {
        assert.strictEqual(renderToStaticMarkup(<Greeting name="World" />), '<p>Hello, World</p>')
    })
})
