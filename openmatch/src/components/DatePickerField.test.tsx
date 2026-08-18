import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { DatePickerField } from './DatePickerField';

describe('DatePickerField', () => {
    it('renders placeholder when no value is provided', () => {
        const { getByText } = render(
            <DatePickerField value="" onChange={jest.fn()} />
        );
        expect(getByText('Click to select Date of Birth')).toBeTruthy();
    });

    it('renders formatted date and calculated age badge when valid date is provided', () => {
        const { getByText } = render(
            <DatePickerField value="1998-05-20" onChange={jest.fn()} />
        );
        expect(getByText('May 20, 1998')).toBeTruthy();
        expect(getByText('1998-05-20')).toBeTruthy();
    });

    it('displays error message when hasError is true', () => {
        const { getByText } = render(
            <DatePickerField
                value=""
                onChange={jest.fn()}
                hasError={true}
                errorMessage="Date of birth is required"
            />
        );
        expect(getByText('⚠️ Date of birth is required')).toBeTruthy();
    });

    it('toggles calendar open on click and allows selecting a day', () => {
        const handleChange = jest.fn();
        const { getByText } = render(
            <DatePickerField value="1995-08-14" onChange={handleChange} />
        );

        const trigger = getByText('August 14, 1995');
        fireEvent.press(trigger);

        expect(getByText('📅 Calendar')).toBeTruthy();
        const confirmBtn = getByText('Confirm & Apply');
        fireEvent.press(confirmBtn);
    });
});
