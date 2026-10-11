#!/usr/bin/env python3
# Concern: checks that mml-extract.py reads both page layouts of the shared Pioneer list table | Non-concern: any whole list (crates/dj-controller-model/models) | IO: none
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("mml_extract", pathlib.Path(__file__).with_name("mml-extract.py"))
mml = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mml)

# Lines of the DDJ-FLX10 list (pages 2 and 7) and of the DDJ-FLX4 list (page 2), as pdftotext -layout prints them.
EXCERPT = "\n".join([
    '                                                                                                                  1/2/3/4      NOTE       11          B-1       9n        0B         hh     9n         0B          hh   OFF=0x00, ON=0x7F',
    '                                                                                                     Vinyl Off    1/2/3/4       CC        35           -        Bn        23         hh      -          -           -',
    'MIXER                                                                                                                                     31                              1F         MSB                                Min (MSB：0x00, LSB：0x00) ～ Max (MSB：0x7F, LSB：0x7F)',
    '             M1                   CROSSFADER                                     slide                   -           7          CC                        -     B6                           -          -          -',
    '                                                                                                                                          63                              3F         LSB                                Min at left side, Max at right side',
    '\x0c',
    '                           Time (minutes) (DECK 1)                                                                           16         CC          -          -          -         -         -     BF       42       hh',
    '\x0c',
    '                                                                                               2           CC         0                     B1        00      MSB         -         -         -',
    '                                                                +SHIFT                                                             -',
    '                                                                                                                     32                               20      LSB         -         -         -',
    '2.EFFECT                                                                                       5         NOTE        16           E0        94        10       7F         -         -         -',
])


class Rows(unittest.TestCase):
    def test_full_rows_split_fourteen_bit_halves_and_output_only_rows(self):
        rows = [(page, way, column, status, d1) for page, _, way, column, status, d1, _, _ in mml.rows(EXCERPT)]
        self.assertEqual(rows, [
            (1, "inout", "1/2/3/4", "9n", "0B"),
            (1, "in", "1/2/3/4", "Bn", "23"),
            (1, "in-msb", "7", "B6", "1F"),
            (1, "in-lsb", "7", "B6", "3F"),
            (2, "out", "16", "BF", "42"),
            (3, "in-msb", "2", "B1", "00"),
            (3, "in-lsb", "2", "B1", "20"),
            (3, "in", "5", "94", "10"),
        ])

    def test_a_status_column_of_n_covers_the_listed_channels(self):
        self.assertEqual(mml.channels("1/2/3/4", "9n"), [0, 1, 2, 3])
        self.assertEqual(mml.channels("6", "B4"), [4])


if __name__ == "__main__":
    unittest.main()
